import type { IncomingMessage, ServerResponse } from "node:http";
import { encodeCursor } from "../../../features/meeting/domain/Cursor.js";
import { MeetingNotFound } from "../../../features/meeting/domain/errors.js";
import type { Message } from "../../../features/meeting/domain/Message.js";
import type {
	MeetingStorePort,
	MeetingSummary,
} from "../../../features/persistence/ports/MeetingStorePort.js";
import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import { asMeetingId } from "../../../shared/types/ids.js";
import { messageDto, snapshotDto, summaryDto } from "./dto.js";
import {
	diffMeetingList,
	indexSummaries,
	maxLastSeq,
	nextBackoff,
	sleep,
	WATCH_KEEPALIVE_MS,
	WATCH_LIST_LIMIT,
	WATCH_MESSAGE_PAGE_LIMIT,
	WATCH_POLL_MS,
} from "./MeetingPoller.js";
import { SseChannel } from "./SseChannel.js";

export interface StreamDeps {
	readonly store: MeetingStorePort;
	readonly logger: LoggerPort;
	readonly channels: Set<SseChannel>;
}

const parseLastSeq = (raw: string | string[] | undefined): number | null => {
	if (typeof raw !== "string" || raw === "") {
		return null;
	}
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) {
		return null;
	}
	return n;
};

const attachLifecycle = (
	request: IncomingMessage,
	response: ServerResponse,
	channel: SseChannel,
	channels: Set<SseChannel>,
): { signal: AbortSignal; keepalive: NodeJS.Timeout } => {
	const controller = new AbortController();
	channels.add(channel);
	const cleanup = (): void => {
		channels.delete(channel);
		controller.abort();
		clearInterval(keepalive);
		channel.close();
	};
	request.on("close", cleanup);
	response.on("close", cleanup);
	const keepalive = setInterval(() => channel.writeKeepalive(), WATCH_KEEPALIVE_MS);
	keepalive.unref();
	return { signal: controller.signal, keepalive };
};

export const streamMeetings = async (
	request: IncomingMessage,
	response: ServerResponse,
	deps: StreamDeps,
): Promise<void> => {
	const channel = new SseChannel(response);
	channel.writeHeaders();
	const { signal } = attachLifecycle(request, response, channel, deps.channels);

	let known = new Map<string, MeetingSummary>();
	let helloEmitted = false;
	let delay = WATCH_POLL_MS;

	while (!signal.aborted) {
		try {
			await deps.store.refresh?.();
			const result = await deps.store.listMeetings({ limit: WATCH_LIST_LIMIT });
			if (!helloEmitted) {
				const summaries = result.summaries.map(summaryDto);
				channel.writeEvent("hello", { summaries }, String(maxLastSeq(result.summaries)));
				known = indexSummaries(result.summaries);
				helloEmitted = true;
				delay = WATCH_POLL_MS;
			} else {
				const diff = diffMeetingList(known, result.summaries);
				for (const summary of diff.added) {
					channel.writeEvent(
						"meeting.added",
						{ summary: summaryDto(summary) },
						String(summary.lastSeq),
					);
				}
				for (const summary of diff.updated) {
					channel.writeEvent(
						"meeting.updated",
						{ summary: summaryDto(summary) },
						String(summary.lastSeq),
					);
				}
				known = indexSummaries(result.summaries);
				delay = WATCH_POLL_MS;
			}
		} catch (err) {
			deps.logger.warn("watch.list-poll-failed", {
				message: (err as Error).message,
			});
			delay = nextBackoff(delay);
		}
		if (signal.aborted) {
			break;
		}
		await sleep(delay, signal);
	}
};

export const streamMeeting = async (
	request: IncomingMessage,
	response: ServerResponse,
	deps: StreamDeps,
	rawId: string,
): Promise<void> => {
	const channel = new SseChannel(response);
	channel.writeHeaders();
	const { signal } = attachLifecycle(request, response, channel, deps.channels);

	const meetingId = asMeetingId(rawId);
	let snapshotSent = false;
	let cursor: string | undefined;
	let lastSummaryKey = "";
	let delay = WATCH_POLL_MS;

	const resumedSeq = parseLastSeq(request.headers["last-event-id"]);

	while (!signal.aborted) {
		try {
			await deps.store.refresh?.();
			if (!snapshotSent) {
				const snapshot = await deps.store.loadMeeting(meetingId);

				const messages: Message[] = [];
				let snapCursor: string | undefined;
				if (resumedSeq !== null && resumedSeq >= -1) {
					snapCursor = encodeCursor({ seq: resumedSeq });
				}
				while (true) {
					const page = await deps.store.readMessagesSince({
						meetingId,
						limit: WATCH_MESSAGE_PAGE_LIMIT,
						...(snapCursor !== undefined ? { cursor: snapCursor } : {}),
					});
					messages.push(...page.messages);
					snapCursor = page.nextCursor;
					if (!page.hasMore) {
						break;
					}
				}
				cursor = snapCursor;

				channel.writeEvent(
					"hello",
					{
						...snapshotDto(snapshot),
						messages: messages.map(messageDto),
					},
					String(snapshot.lastSeq),
				);
				snapshotSent = true;
				lastSummaryKey = `${snapshot.meeting.status}|${snapshot.lastSeq}|${snapshot.openJobs.length}`;
				delay = WATCH_POLL_MS;
			} else {
				while (true) {
					const page = await deps.store.readMessagesSince({
						meetingId,
						limit: WATCH_MESSAGE_PAGE_LIMIT,
						...(cursor !== undefined ? { cursor } : {}),
					});
					for (const m of page.messages) {
						channel.writeEvent(
							"message.posted",
							{ message: messageDto(m) },
							String(m.seq),
						);
					}
					cursor = page.nextCursor;
					if (!page.hasMore) {
						break;
					}
				}

				const list = await deps.store.listMeetings({ limit: WATCH_LIST_LIMIT });
				const current = list.summaries.find((s) => s.meetingId === rawId);
				if (current !== undefined) {
					const key = `${current.status}|${current.lastSeq}|${current.openJobCount}`;
					if (key !== lastSummaryKey) {
						channel.writeEvent(
							"meeting.updated",
							{ summary: summaryDto(current) },
							String(current.lastSeq),
						);
						lastSummaryKey = key;
					}
				}
				delay = WATCH_POLL_MS;
			}
		} catch (err) {
			if (err instanceof MeetingNotFound) {
				channel.writeEvent("error", {
					code: "meeting-not-found",
					message: `meeting ${rawId} not found`,
				});
				channel.close();
				return;
			}
			deps.logger.warn("watch.transcript-poll-failed", {
				meetingId: rawId,
				message: (err as Error).message,
			});
			delay = nextBackoff(delay);
		}
		if (signal.aborted) {
			break;
		}
		await sleep(delay, signal);
	}
};
