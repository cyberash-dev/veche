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
		root = await mkdtemp(path.join(os.tmpdir(), "ai-meeting-test-"));
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
});
