import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FACILITATOR_DISCUSSION_ROLE } from "../../../../features/meeting/domain/Participant.js";
import { FileMeetingStore } from "../../../../features/persistence/adapters/file/FileMeetingStore.js";
import { asMeetingId, asMessageId, asParticipantId } from "../../../../shared/types/ids.js";
import { asInstant } from "../../../../shared/types/instant.js";
import { FakeClock } from "../../../../test-utils/FakeClock.js";
import { SilentLogger } from "../../../../test-utils/SilentLogger.js";
import { WatchServer } from "../WatchServer.js";

interface SseEvent {
	readonly event: string;
	readonly data: unknown;
}

interface SseSubscription {
	readonly readUntil: (
		predicate: (events: readonly SseEvent[]) => boolean,
		timeoutMs?: number,
	) => Promise<readonly SseEvent[]>;
	readonly close: () => Promise<void>;
}

const subscribe = (response: Response): SseSubscription => {
	if (response.body === null) {
		throw new Error("response has no body");
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const events: SseEvent[] = [];
	let buffer = "";
	const drain = (block: string): void => {
		if (block.startsWith(":")) {
			return;
		}
		let event = "message";
		let data = "";
		for (const line of block.split("\n")) {
			if (line.startsWith("event: ")) {
				event = line.slice(7).trim();
			} else if (line.startsWith("data: ")) {
				data = line.slice(6);
			}
		}
		let parsed: unknown = null;
		if (data.length > 0) {
			try {
				parsed = JSON.parse(data.replace(/\\n/g, "\n"));
			} catch {
				parsed = data;
			}
		}
		events.push({ event, data: parsed });
	};
	const readUntil = async (
		predicate: (events: readonly SseEvent[]) => boolean,
		timeoutMs = 5000,
	): Promise<readonly SseEvent[]> => {
		if (predicate(events)) {
			return events.slice();
		}
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const remaining = deadline - Date.now();
			const timer = new Promise<{ value?: undefined; done?: undefined }>((resolve) =>
				setTimeout(() => resolve({}), Math.max(50, remaining)),
			);
			const next = await Promise.race([reader.read(), timer]);
			if ("done" in next && next.done) {
				break;
			}
			if ("value" in next && next.value) {
				buffer += decoder.decode(next.value, { stream: true });
				while (true) {
					const sep = buffer.indexOf("\n\n");
					if (sep < 0) {
						break;
					}
					const block = buffer.slice(0, sep);
					buffer = buffer.slice(sep + 2);
					drain(block);
				}
				if (predicate(events)) {
					break;
				}
			}
		}
		return events.slice();
	};
	const close = async (): Promise<void> => {
		try {
			await reader.cancel();
		} catch {
			// ignore
		}
	};
	return { readUntil, close };
};

describe("watch server picks up cross-process meeting changes", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "veche-watch-cp-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("emits meeting.added when another process creates a meeting after the watcher started", async () => {
		const clock = new FakeClock();
		const logger = new SilentLogger();
		const reader = new FileMeetingStore({ clock, logger }, { rootDir: root });
		const server = new WatchServer(
			{ host: "127.0.0.1", port: 0, version: "test" },
			{ store: reader, clock, logger },
		);
		const { url } = await server.start();
		try {
			const res = await fetch(`${url}api/stream`);
			expect(res.status).toBe(200);
			const sub = subscribe(res);

			// Reader's hello should be empty.
			const initial = await sub.readUntil((es) => es.some((e) => e.event === "hello"), 2000);
			const hello = initial.find((e) => e.event === "hello");
			expect(hello).toBeDefined();
			expect((hello?.data as { summaries: unknown[] }).summaries).toHaveLength(0);

			// Now another process (a fresh FileMeetingStore on the same root) creates a meeting.
			const writer = new FileMeetingStore({ clock, logger }, { rootDir: root });
			const meetingId = asMeetingId("cross-1");
			await writer.createMeeting({
				meeting: {
					id: meetingId,
					title: "Started by writer",
					status: "active",
					createdAt: asInstant("2026-04-25T11:00:00.000Z"),
					endedAt: null,
					participants: [],
					defaultMaxRounds: 3,
				},
				participants: [
					{
						id: asParticipantId("alice"),
						role: "facilitator",
						participantKind: "human",
						discussionRole: DEFAULT_FACILITATOR_DISCUSSION_ROLE,
						isHumanParticipationEnabled: false,
						displayName: "alice",
						adapter: null,
						profile: null,
						systemPrompt: null,
						workdir: null,
						model: null,
						extraFlags: [],
						env: {},
						sessionId: null,
						providerRef: null,
						status: "active",
						droppedAt: null,
						droppedReason: null,
					},
				],
			});
			await writer.appendMessage({
				meetingId,
				jobId: null,
				message: {
					id: asMessageId("xp-1"),
					round: 0,
					author: asParticipantId("alice"),
					kind: "speech",
					text: "hello from another process",
					createdAt: asInstant("2026-04-25T11:00:01.000Z"),
				},
			});

			const events = await sub.readUntil(
				(es) => es.some((e) => e.event === "meeting.added"),
				6000,
			);
			const added = events.find((e) => e.event === "meeting.added");
			expect(added).toBeDefined();
			const summary = (added?.data as { summary: { meetingId: string; title: string } })
				.summary;
			expect(summary.meetingId).toBe(meetingId);
			expect(summary.title).toBe("Started by writer");
			await sub.close();
		} finally {
			await server.stop();
		}
	});
});
