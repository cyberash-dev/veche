import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MeetingNotFound } from "../../../../features/meeting/domain/errors.js";
import type { Job } from "../../../../features/meeting/domain/Job.js";
import type { Message } from "../../../../features/meeting/domain/Message.js";
import type { AnyEvent } from "../../../../features/persistence/domain/Event.js";
import type { MeetingStorePort } from "../../../../features/persistence/ports/MeetingStorePort.js";
import type { ClockPort } from "../../../../shared/ports/ClockPort.js";
import { asMeetingId } from "../../../../shared/types/ids.js";
import { renderHtml } from "../renderers/html.js";
import { renderJson } from "../renderers/json.js";
import { renderMarkdown } from "../renderers/markdown.js";
import { renderText } from "../renderers/text.js";
import type { Renderer } from "../renderers/types.js";

export interface ShowCommand {
	readonly meetingId: string;
	readonly format: "text" | "html" | "json" | "markdown";
	readonly out: string | null; // null → stdout, "-" also stdout, else path
	readonly open: boolean;
	readonly raw: boolean;
	readonly useColor: boolean;
}

export interface ShowDeps {
	readonly store: MeetingStorePort;
	readonly clock: ClockPort;
	readonly version: string;
	readonly stdout: (s: string) => void;
	readonly stderr: (s: string) => void;
}

const RENDERERS: Record<ShowCommand["format"], Renderer> = {
	text: renderText,
	html: renderHtml,
	markdown: renderMarkdown,
	json: renderJson,
};

const PAGE_SIZE = 500;

/** Fold persisted events into the full list of Jobs (open and terminal). */
const reduceJobs = (events: readonly AnyEvent[]): Job[] => {
	const byId = new Map<string, Job>();
	for (const ev of events) {
		if (ev.type === "job.started") {
			byId.set(ev.payload.jobId, {
				id: ev.payload.jobId,
				meetingId: ev.meetingId,
				status: "running",
				createdAt: ev.at,
				startedAt: ev.at,
				finishedAt: null,
				maxRounds: ev.payload.maxRounds,
				turnTimeoutMs: ev.payload.turnTimeoutMs,
				addressees: ev.payload.addressees,
				lastSeq: -1,
				rounds: 0,
				terminationReason: null,
				error: null,
				cancelReason: null,
			});
		} else if (ev.type === "round.completed") {
			const j = byId.get(ev.payload.jobId);
			if (j) {
				byId.set(j.id, { ...j, rounds: ev.payload.roundNumber });
			}
		} else if (ev.type === "job.completed") {
			const j = byId.get(ev.payload.jobId);
			if (j) {
				byId.set(j.id, {
					...j,
					status: "completed",
					finishedAt: ev.at,
					lastSeq: ev.payload.lastSeq,
					rounds: ev.payload.rounds,
					terminationReason: ev.payload.terminationReason,
				});
			}
		} else if (ev.type === "job.failed") {
			const j = byId.get(ev.payload.jobId);
			if (j) {
				byId.set(j.id, {
					...j,
					status: "failed",
					finishedAt: ev.at,
					error: ev.payload.error,
				});
			}
		} else if (ev.type === "job.cancelled") {
			const j = byId.get(ev.payload.jobId);
			if (j) {
				byId.set(j.id, {
					...j,
					status: "cancelled",
					finishedAt: ev.at,
					cancelReason: ev.payload.cancelReason,
				});
			}
		}
	}
	return Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

const resolveOpener = (): { bin: string; args: string[] } | null => {
	if (process.platform === "darwin") {
		return { bin: "open", args: [] };
	}
	if (process.platform === "win32") {
		return { bin: "cmd.exe", args: ["/c", "start", ""] };
	}
	return { bin: "xdg-open", args: [] };
};

const writeFileAtomic = async (filePath: string, content: string): Promise<void> => {
	const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	await fs.writeFile(tmp, content, { mode: 0o600 });
	await fs.rename(tmp, filePath);
};

export const runShow = async (cmd: ShowCommand, deps: ShowDeps): Promise<number> => {
	const { store, clock, stdout, stderr, version } = deps;
	const meetingId = asMeetingId(cmd.meetingId);

	let snapshot: Awaited<ReturnType<MeetingStorePort["loadMeeting"]>>;
	try {
		snapshot = await store.loadMeeting(meetingId);
	} catch (err) {
		if (err instanceof MeetingNotFound) {
			stderr(`meeting ${cmd.meetingId} not found\n`);
			return 3;
		}
		throw err;
	}

	// Collect the body.
	const messages: Message[] = [];
	let events: AnyEvent[] | null = null;
	if (cmd.raw) {
		if (!store.readAllEvents) {
			stderr("store does not expose readAllEvents; cannot produce --raw output\n");
			return 2;
		}
		events = [...(await store.readAllEvents(meetingId))];
	} else {
		let cursor: string | undefined;
		for (;;) {
			const page = await store.readMessagesSince({
				meetingId,
				...(cursor !== undefined ? { cursor } : {}),
				limit: PAGE_SIZE,
			});
			messages.push(...page.messages);
			cursor = page.nextCursor;
			if (!page.hasMore) {
				break;
			}
		}
	}

	// Compute the complete job list for the header (openJobs is insufficient).
	const jobs = store.readAllEvents
		? reduceJobs(await store.readAllEvents(meetingId))
		: [...snapshot.openJobs];

	const renderer = RENDERERS[cmd.format];
	const output = renderer({
		meeting: snapshot.meeting,
		participants: snapshot.participants,
		jobs,
		messages,
		events,
		generatedAt: clock.now(),
		useColor: cmd.useColor,
		version,
	});

	// Dispatch the output.
	if (cmd.open) {
		const tmpPath = path.join(os.tmpdir(), `ai-meeting-${cmd.meetingId}.html`);
		try {
			await writeFileAtomic(tmpPath, output);
		} catch (err) {
			stderr(`failed to write ${tmpPath}: ${(err as Error).message}\n`);
			return 2;
		}
		const opener = resolveOpener();
		if (!opener) {
			stderr(`no browser opener available on ${process.platform}; wrote ${tmpPath}\n`);
			return 0;
		}
		try {
			const child = spawn(opener.bin, [...opener.args, tmpPath], {
				detached: true,
				stdio: "ignore",
			});
			child.unref();
			stderr(`opened ${tmpPath}\n`);
		} catch {
			stderr(`opener failed; wrote ${tmpPath}\n`);
		}
		return 0;
	}

	if (cmd.out !== null && cmd.out !== "-") {
		try {
			await writeFileAtomic(cmd.out, output);
			stderr(`wrote ${cmd.out}\n`);
		} catch (err) {
			stderr(`failed to write ${cmd.out}: ${(err as Error).message}\n`);
			return 2;
		}
		return 0;
	}

	stdout(output);
	return 0;
};
