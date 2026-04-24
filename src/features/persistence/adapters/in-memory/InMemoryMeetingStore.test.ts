import { describe, expect, it } from "vitest";
import { asParticipantId } from "../../../../shared/types/ids.js";
import { FakeClock } from "../../../../test-utils/FakeClock.js";
import { FakeIdGen } from "../../../../test-utils/FakeIdGen.js";
import { decodeCursor } from "../../../meeting/domain/Cursor.js";
import type { Job } from "../../../meeting/domain/Job.js";
import type { Meeting } from "../../../meeting/domain/Meeting.js";
import type { Participant } from "../../../meeting/domain/Participant.js";
import { InMemoryMeetingStore } from "./InMemoryMeetingStore.js";

const makeMeeting = (
	clock: FakeClock,
	ids: FakeIdGen,
): {
	meeting: Meeting;
	participants: Participant[];
} => {
	const meetingId = ids.newMeetingId();
	const facilitatorId = asParticipantId("claude");
	const memberId = asParticipantId("codex");
	const meeting: Meeting = {
		id: meetingId,
		title: "Test meeting",
		status: "active",
		createdAt: clock.now(),
		endedAt: null,
		participants: [],
		defaultMaxRounds: 8,
	};
	const facilitator: Participant = {
		id: facilitatorId,
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
	const member: Participant = {
		...facilitator,
		id: memberId,
		role: "member",
		displayName: "codex",
		adapter: "codex-cli",
		sessionId: ids.newParticipantSessionId(),
	};
	return { meeting, participants: [facilitator, member] };
};

describe("InMemoryMeetingStore", () => {
	it("creates a meeting and assigns seq to events", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const store = new InMemoryMeetingStore(clock);
		const { meeting, participants } = makeMeeting(clock, ids);

		const snap = await store.createMeeting({ meeting, participants });
		expect(snap.meeting.id).toBe(meeting.id);
		expect(snap.participants).toHaveLength(2);
		// meeting.created + 2 participant.joined → lastSeq = 2
		expect(snap.lastSeq).toBe(2);
	});

	it("rejects duplicate meeting creation", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const store = new InMemoryMeetingStore(clock);
		const { meeting, participants } = makeMeeting(clock, ids);
		await store.createMeeting({ meeting, participants });
		await expect(store.createMeeting({ meeting, participants })).rejects.toMatchObject({
			code: "MeetingAlreadyExists",
		});
	});

	it("appends messages with monotonic seq and paginates via cursor", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const store = new InMemoryMeetingStore(clock);
		const { meeting, participants } = makeMeeting(clock, ids);
		await store.createMeeting({ meeting, participants });

		for (let i = 0; i < 5; i++) {
			await store.appendMessage({
				meetingId: meeting.id,
				jobId: null,
				message: {
					id: ids.newMessageId(),
					round: 0,
					author: asParticipantId("claude"),
					kind: "speech",
					text: `hello ${i}`,
					createdAt: clock.now(),
				},
			});
		}

		const page1 = await store.readMessagesSince({ meetingId: meeting.id, limit: 3 });
		expect(page1.messages).toHaveLength(3);
		expect(page1.hasMore).toBe(true);

		const page2 = await store.readMessagesSince({
			meetingId: meeting.id,
			cursor: page1.nextCursor,
			limit: 10,
		});
		expect(page2.messages).toHaveLength(2);
		expect(page2.hasMore).toBe(false);
		// All messages strictly after the first page
		for (const m of page2.messages) {
			expect(m.seq).toBeGreaterThan(decodeCursor(page1.nextCursor).seq);
		}
	});

	it("enforces one open job per meeting", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const store = new InMemoryMeetingStore(clock);
		const { meeting, participants } = makeMeeting(clock, ids);
		await store.createMeeting({ meeting, participants });

		const job: Job = {
			id: ids.newJobId(),
			meetingId: meeting.id,
			status: "queued",
			createdAt: clock.now(),
			startedAt: null,
			finishedAt: null,
			maxRounds: 5,
			turnTimeoutMs: 60_000,
			addressees: null,
			lastSeq: -1,
			terminationReason: null,
			error: null,
			cancelReason: null,
		};
		await store.createJob(job);
		await expect(store.createJob({ ...job, id: ids.newJobId() })).rejects.toMatchObject({
			code: "JobStateTransitionInvalid",
		});
	});

	it("validates job state transitions", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const store = new InMemoryMeetingStore(clock);
		const { meeting, participants } = makeMeeting(clock, ids);
		await store.createMeeting({ meeting, participants });

		const jobId = ids.newJobId();
		const job: Job = {
			id: jobId,
			meetingId: meeting.id,
			status: "queued",
			createdAt: clock.now(),
			startedAt: null,
			finishedAt: null,
			maxRounds: 5,
			turnTimeoutMs: 60_000,
			addressees: null,
			lastSeq: -1,
			terminationReason: null,
			error: null,
			cancelReason: null,
		};
		await store.createJob(job);
		await store.updateJob({ jobId, patch: { status: "running" } });
		await store.updateJob({ jobId, patch: { status: "completed" } });
		await expect(
			store.updateJob({ jobId, patch: { status: "running" } }),
		).rejects.toMatchObject({ code: "JobStateTransitionInvalid" });
	});

	it("watchNewEvents resolves on new append", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const store = new InMemoryMeetingStore(clock);
		const { meeting, participants } = makeMeeting(clock, ids);
		await store.createMeeting({ meeting, participants });

		const baseSnap = await store.loadMeeting(meeting.id);
		const baseCursor = `eyJzZXEiOiR9`.replace("$", String(baseSnap.lastSeq));
		// Use a freshly encoded cursor
		const cursor = Buffer.from(JSON.stringify({ seq: baseSnap.lastSeq })).toString("base64url");
		void baseCursor;

		const waited = store.watchNewEvents({ meetingId: meeting.id, cursor, timeoutMs: 1000 });
		await store.appendMessage({
			meetingId: meeting.id,
			jobId: null,
			message: {
				id: ids.newMessageId(),
				round: 0,
				author: asParticipantId("claude"),
				kind: "speech",
				text: "ping",
				createdAt: clock.now(),
			},
		});
		await waited;
	});
});
