import { mkdtemp, rm } from "node:fs/promises";
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
