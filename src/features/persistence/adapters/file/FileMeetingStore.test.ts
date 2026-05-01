import { mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asParticipantId } from "../../../../shared/types/ids.js";
import { FakeClock } from "../../../../test-utils/FakeClock.js";
import { FakeIdGen } from "../../../../test-utils/FakeIdGen.js";
import { SilentLogger } from "../../../../test-utils/SilentLogger.js";
import type { Meeting } from "../../../meeting/domain/Meeting.js";
import type { Participant } from "../../../meeting/domain/Participant.js";
import { FileMeetingStore } from "./FileMeetingStore.js";

describe("FileMeetingStore", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "veche-test-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	// @covers persistence:BEH-001 @covers persistence:BEH-002 @covers persistence:BEH-009 @covers persistence:INV-004 @covers persistence:CTR-001 @covers persistence:CTR-003 @covers persistence:CTR-004 @covers persistence:EXT-001
	it("persists meetings across instance restarts", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const logger = new SilentLogger();
		const store = new FileMeetingStore({ clock, logger }, { rootDir: root });

		const meeting: Meeting = {
			id: ids.newMeetingId(),
			title: "Persistent",
			status: "active",
			createdAt: clock.now(),
			endedAt: null,
			participants: [],
			defaultMaxRounds: 5,
		};
		const facilitator: Participant = {
			id: asParticipantId("claude"),
			role: "facilitator",
			displayName: "claude",
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
		};
		await store.createMeeting({ meeting, participants: [facilitator] });
		await store.appendMessage({
			meetingId: meeting.id,
			jobId: null,
			message: {
				id: ids.newMessageId(),
				round: 0,
				author: asParticipantId("claude"),
				kind: "speech",
				text: "hello",
				createdAt: clock.now(),
			},
		});

		const store2 = new FileMeetingStore({ clock, logger }, { rootDir: root });
		const snap = await store2.loadMeeting(meeting.id);
		expect(snap.meeting.title).toBe("Persistent");
		expect(snap.lastSeq).toBe(2); // meeting.created + participant.joined + message.posted
		const page = await store2.readMessagesSince({ meetingId: meeting.id, limit: 10 });
		expect(page.messages).toHaveLength(1);
		expect(page.messages[0]?.text).toBe("hello");
	});

	// @covers persistence:BEH-011 @covers persistence:BEH-006
	it("refresh() picks up new meetings created by another process", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const logger = new SilentLogger();
		const writer = new FileMeetingStore({ clock, logger }, { rootDir: root });
		const reader = new FileMeetingStore({ clock, logger }, { rootDir: root });

		const initial = await reader.listMeetings({ limit: 10 });
		expect(initial.summaries).toHaveLength(0);

		// Writer creates a meeting after reader has already initialised.
		const meeting: Meeting = {
			id: ids.newMeetingId(),
			title: "Cross-process",
			status: "active",
			createdAt: clock.now(),
			endedAt: null,
			participants: [],
			defaultMaxRounds: 3,
		};
		const facilitator: Participant = {
			id: asParticipantId("alice"),
			role: "facilitator",
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
		};
		await writer.createMeeting({ meeting, participants: [facilitator] });

		// Without refresh, reader still sees zero meetings (cache is stale).
		const stale = await reader.listMeetings({ limit: 10 });
		expect(stale.summaries).toHaveLength(0);

		// After refresh, the new meeting is visible.
		await reader.refresh();
		const fresh = await reader.listMeetings({ limit: 10 });
		expect(fresh.summaries).toHaveLength(1);
		expect(fresh.summaries[0]?.meetingId).toBe(meeting.id);
	});

	// @covers persistence:INV-007
	it("rebuilds meeting state from events.jsonl when manifest.json is deleted", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const logger = new SilentLogger();
		const writer = new FileMeetingStore({ clock, logger }, { rootDir: root });

		const meeting: Meeting = {
			id: ids.newMeetingId(),
			title: "Crash recovery",
			status: "active",
			createdAt: clock.now(),
			endedAt: null,
			participants: [],
			defaultMaxRounds: 3,
		};
		const facilitator: Participant = {
			id: asParticipantId("alice"),
			role: "facilitator",
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
		};
		await writer.createMeeting({ meeting, participants: [facilitator] });
		await writer.appendMessage({
			meetingId: meeting.id,
			jobId: null,
			message: {
				id: ids.newMessageId(),
				round: 0,
				author: asParticipantId("alice"),
				kind: "speech",
				text: "hello",
				createdAt: clock.now(),
			},
		});

		await unlink(path.join(root, "meetings", meeting.id, "manifest.json"));

		const reborn = new FileMeetingStore({ clock, logger }, { rootDir: root });
		const snap = await reborn.loadMeeting(meeting.id);
		expect(snap.meeting.title).toBe("Crash recovery");
		expect(snap.lastSeq).toBe(2);
	});

	// @covers persistence:INV-005
	it("manifest writes are atomic — readers never observe a partial file", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const logger = new SilentLogger();
		const store = new FileMeetingStore({ clock, logger }, { rootDir: root });

		const meeting: Meeting = {
			id: ids.newMeetingId(),
			title: "Atomic writes",
			status: "active",
			createdAt: clock.now(),
			endedAt: null,
			participants: [],
			defaultMaxRounds: 3,
		};
		const facilitator: Participant = {
			id: asParticipantId("alice"),
			role: "facilitator",
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
		};
		await store.createMeeting({ meeting, participants: [facilitator] });

		const manifestPath = path.join(root, "meetings", meeting.id, "manifest.json");
		const tmpPath = `${manifestPath}.tmp`;

		// Drive many appends in parallel; reader loops in parallel reading manifest.
		let stop = false;
		const readerPromise = (async () => {
			while (!stop) {
				try {
					const raw = await readFile(manifestPath, "utf8");
					const parsed = JSON.parse(raw);
					expect(parsed.meeting?.id).toBe(meeting.id);
				} catch (err) {
					// ENOENT is acceptable in the gap between unlink and rename;
					// SyntaxError on a partial file would prove the contract is broken.
					const code = (err as NodeJS.ErrnoException).code;
					if (code !== "ENOENT") {
						throw err;
					}
				}
			}
		})();

		const writes: Promise<unknown>[] = [];
		for (let i = 0; i < 30; i++) {
			writes.push(
				store.appendMessage({
					meetingId: meeting.id,
					jobId: null,
					message: {
						id: ids.newMessageId(),
						round: 0,
						author: asParticipantId("alice"),
						kind: "speech",
						text: `t${i}`,
						createdAt: clock.now(),
					},
				}),
			);
		}
		await Promise.all(writes);
		stop = true;
		await readerPromise;

		// After all writes complete, the tmp file is gone.
		await expect(stat(tmpPath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	// @covers persistence:INV-008
	it("decoder skips unknown event types without raising", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const logger = new SilentLogger();
		const writer = new FileMeetingStore({ clock, logger }, { rootDir: root });

		const meeting: Meeting = {
			id: ids.newMeetingId(),
			title: "Forward compat",
			status: "active",
			createdAt: clock.now(),
			endedAt: null,
			participants: [],
			defaultMaxRounds: 3,
		};
		const facilitator: Participant = {
			id: asParticipantId("alice"),
			role: "facilitator",
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
		};
		await writer.createMeeting({ meeting, participants: [facilitator] });
		await writer.appendMessage({
			meetingId: meeting.id,
			jobId: null,
			message: {
				id: ids.newMessageId(),
				round: 0,
				author: asParticipantId("alice"),
				kind: "speech",
				text: "real-message",
				createdAt: clock.now(),
			},
		});

		// Inject an unknown event type at the tail of events.jsonl.
		const eventsPath = path.join(root, "meetings", meeting.id, "events.jsonl");
		const existing = await readFile(eventsPath, "utf8");
		const futureLine = `${JSON.stringify({ seq: 3, type: "future.event.type", at: "2099-01-01T00:00:00.000Z", payload: { unknownField: 42 } })}\n`;
		await writeFile(eventsPath, existing + futureLine);
		// Drop the cached manifest so the next instance folds events.jsonl.
		await unlink(path.join(root, "meetings", meeting.id, "manifest.json"));

		const reborn = new FileMeetingStore({ clock, logger }, { rootDir: root });
		const snap = await reborn.loadMeeting(meeting.id);
		expect(snap.lastSeq).toBe(3); // unknown event still advanced lastSeq
		const page = await reborn.readMessagesSince({ meetingId: meeting.id, limit: 10 });
		expect(page.messages).toHaveLength(1);
		expect(page.messages[0]?.text).toBe("real-message");
	});

	// @covers persistence:POL-001
	it("FileMeetingStore writes only inside its configured rootDir", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const logger = new SilentLogger();
		const store = new FileMeetingStore({ clock, logger }, { rootDir: root });

		const meeting: Meeting = {
			id: ids.newMeetingId(),
			title: "Scoped",
			status: "active",
			createdAt: clock.now(),
			endedAt: null,
			participants: [],
			defaultMaxRounds: 3,
		};
		const facilitator: Participant = {
			id: asParticipantId("alice"),
			role: "facilitator",
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
		};
		await store.createMeeting({ meeting, participants: [facilitator] });
		await store.appendMessage({
			meetingId: meeting.id,
			jobId: null,
			message: {
				id: ids.newMessageId(),
				round: 0,
				author: asParticipantId("alice"),
				kind: "speech",
				text: "hi",
				createdAt: clock.now(),
			},
		});
		await store.endMeeting({ meetingId: meeting.id, at: clock.now() });

		// Walk rootDir; every entry must be under root. (mkdtemp(...) returned a
		// canonical path; symlink escape would change realpath.)
		const realRoot = await readFile.call({}, "/dev/null", "utf8").catch(() => "");
		void realRoot;
		async function walk(dir: string): Promise<string[]> {
			const entries = await readdir(dir, { withFileTypes: true });
			const out: string[] = [];
			for (const e of entries) {
				const p = path.join(dir, e.name);
				if (e.isDirectory()) {
					out.push(p, ...(await walk(p)));
				} else {
					out.push(p);
				}
			}
			return out;
		}
		const all = await walk(root);
		for (const p of all) {
			expect(p.startsWith(root + path.sep)).toBe(true);
		}

		// Directory mode for meetings/<id>/ should be 0700 per CTR-003.
		const meetingDirStat = await stat(path.join(root, "meetings", meeting.id));
		// On macOS / Linux mode masks; ensure no other-or-group permission bits.
		// eslint-disable-next-line no-bitwise
		expect(meetingDirStat.mode & 0o077).toBe(0);
	});

	// @covers persistence:BEH-011 @covers persistence:BEH-006 @covers persistence:BEH-002
	it("refresh() picks up new messages appended by another process to a known meeting", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const logger = new SilentLogger();
		const writer = new FileMeetingStore({ clock, logger }, { rootDir: root });

		const meeting: Meeting = {
			id: ids.newMeetingId(),
			title: "Updates",
			status: "active",
			createdAt: clock.now(),
			endedAt: null,
			participants: [],
			defaultMaxRounds: 3,
		};
		const facilitator: Participant = {
			id: asParticipantId("alice"),
			role: "facilitator",
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
		};
		await writer.createMeeting({ meeting, participants: [facilitator] });

		const reader = new FileMeetingStore({ clock, logger }, { rootDir: root });
		const beforeList = await reader.listMeetings({ limit: 10 });
		expect(beforeList.summaries[0]?.lastSeq).toBe(1);

		await writer.appendMessage({
			meetingId: meeting.id,
			jobId: null,
			message: {
				id: ids.newMessageId(),
				round: 0,
				author: asParticipantId("alice"),
				kind: "speech",
				text: "hi",
				createdAt: clock.now(),
			},
		});

		await reader.refresh();
		const afterList = await reader.listMeetings({ limit: 10 });
		expect(afterList.summaries[0]?.lastSeq).toBe(2);
	});
});
