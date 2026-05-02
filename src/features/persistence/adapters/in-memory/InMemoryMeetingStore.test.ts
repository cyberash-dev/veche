import { describe, expect, it } from "vitest";
import { asParticipantId } from "../../../../shared/types/ids.js";
import { FakeClock } from "../../../../test-utils/FakeClock.js";
import { FakeIdGen } from "../../../../test-utils/FakeIdGen.js";
import { decodeCursor } from "../../../meeting/domain/Cursor.js";
import type { Job } from "../../../meeting/domain/Job.js";
import type { Meeting } from "../../../meeting/domain/Meeting.js";
import {
	DEFAULT_FACILITATOR_DISCUSSION_ROLE,
	DEFAULT_MODEL_DISCUSSION_ROLE,
	type Participant,
} from "../../../meeting/domain/Participant.js";
import type { AnyEvent } from "../../domain/Event.js";
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
		participantKind: "human",
		discussionRole: DEFAULT_FACILITATOR_DISCUSSION_ROLE,
		isHumanParticipationEnabled: false,
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
		participantKind: "model",
		discussionRole: DEFAULT_MODEL_DISCUSSION_ROLE,
		isHumanParticipationEnabled: false,
		displayName: "codex",
		adapter: "codex-cli",
		sessionId: ids.newParticipantSessionId(),
	};
	return { meeting, participants: [facilitator, member] };
};

describe("InMemoryMeetingStore", () => {
	// @covers persistence:BEH-001 @covers persistence:INV-002
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

	// @covers persistence:BEH-001
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

	// @covers persistence:BEH-002 @covers persistence:BEH-003 @covers persistence:CTR-005 @covers persistence:INV-002 @covers persistence:INV-003
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

	// @covers persistence:BEH-004
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
			rounds: 0,
			terminationReason: null,
			error: null,
			cancelReason: null,
		};
		await store.createJob(job);
		await expect(store.createJob({ ...job, id: ids.newJobId() })).rejects.toMatchObject({
			code: "JobStateTransitionInvalid",
		});
	});

	// @covers persistence:BEH-004
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
			rounds: 0,
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

	// @covers persistence:BEH-005
	it("endMeeting flips status to ended and rejects subsequent writes", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const store = new InMemoryMeetingStore(clock);
		const { meeting, participants } = makeMeeting(clock, ids);
		await store.createMeeting({ meeting, participants });

		const ended = await store.endMeeting({ meetingId: meeting.id, at: clock.now() });
		expect(ended.meeting.status).toBe("ended");
		expect(ended.meeting.endedAt).toEqual(clock.now());

		await expect(
			store.appendMessage({
				meetingId: meeting.id,
				jobId: null,
				message: {
					id: ids.newMessageId(),
					round: 0,
					author: asParticipantId("claude"),
					kind: "speech",
					text: "after end",
					createdAt: clock.now(),
				},
			}),
		).rejects.toMatchObject({ code: "MeetingAlreadyEnded" });

		await expect(
			store.endMeeting({ meetingId: meeting.id, at: clock.now() }),
		).rejects.toMatchObject({ code: "MeetingAlreadyEnded" });
	});

	// @covers persistence:BEH-007
	it("appendSystemEvent persists a non-message event and advances seq", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const store = new InMemoryMeetingStore(clock);
		const { meeting, participants } = makeMeeting(clock, ids);
		const snap = await store.createMeeting({ meeting, participants });
		const seqBefore = snap.lastSeq;

		const result = await store.appendSystemEvent({
			meetingId: meeting.id,
			type: "round.started",
			payload: { roundNumber: 1, activeParticipantIds: [asParticipantId("codex")] },
			at: clock.now(),
		});
		expect(result.seq).toBe(seqBefore + 1);

		const events = (await store.readAllEvents?.(meeting.id)) ?? [];
		const last = events[events.length - 1];
		expect(last?.type).toBe("round.started");
		expect(last?.seq).toBe(seqBefore + 1);
	});

	// @covers persistence:BEH-008
	it("markParticipantDropped persists a participant.dropped event", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const store = new InMemoryMeetingStore(clock);
		const { meeting, participants } = makeMeeting(clock, ids);
		await store.createMeeting({ meeting, participants });

		await store.markParticipantDropped({
			meetingId: meeting.id,
			participantId: asParticipantId("codex"),
			reason: "adapter-timeout",
			error: { code: "AdapterTurnTimeout", message: "exceeded 60s" },
			jobId: null,
			at: clock.now(),
		});

		const events = (await store.readAllEvents?.(meeting.id)) ?? [];
		const dropEvent = events.find((e) => e.type === "participant.dropped");
		expect(dropEvent).toBeDefined();
		expect(dropEvent?.payload).toMatchObject({
			participantId: "codex",
			reason: "adapter-timeout",
			error: { code: "AdapterTurnTimeout", message: "exceeded 60s" },
		});

		await expect(
			store.markParticipantDropped({
				meetingId: meeting.id,
				participantId: asParticipantId("ghost"),
				reason: "ghost-drop",
				error: null,
				jobId: null,
				at: clock.now(),
			}),
		).rejects.toMatchObject({ code: "ParticipantNotFound" });
	});

	// @covers persistence:CTR-002
	it("emits each event type with its canonical payload shape", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const store = new InMemoryMeetingStore(clock);
		const { meeting, participants } = makeMeeting(clock, ids);
		await store.createMeeting({ meeting, participants });

		const jobId = ids.newJobId();
		await store.createJob({
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
			rounds: 0,
			terminationReason: null,
			error: null,
			cancelReason: null,
		});
		await store.appendSystemEvent({
			meetingId: meeting.id,
			type: "job.started",
			payload: { jobId, maxRounds: 5 },
			at: clock.now(),
		});
		await store.appendMessage({
			meetingId: meeting.id,
			jobId,
			message: {
				id: ids.newMessageId(),
				round: 0,
				author: asParticipantId("claude"),
				kind: "speech",
				text: "hi",
				createdAt: clock.now(),
			},
		});
		await store.endMeeting({ meetingId: meeting.id, at: clock.now() });

		const events = ((await store.readAllEvents?.(meeting.id)) ?? []) as AnyEvent[];
		const byType = new Map(events.map((e) => [e.type, e]));

		expect(byType.get("meeting.created")?.payload).toEqual(
			expect.objectContaining({
				title: meeting.title,
				defaultMaxRounds: meeting.defaultMaxRounds,
			}),
		);
		const joined = byType.get("participant.joined");
		expect(joined).toBeDefined();
		expect((joined?.payload as { participant: unknown }).participant).toMatchObject({
			id: expect.any(String),
			role: expect.stringMatching(/facilitator|member/),
		});
		expect(byType.get("job.started")?.payload).toEqual(
			expect.objectContaining({ jobId, maxRounds: 5 }),
		);
		expect(byType.get("message.posted")?.payload).toEqual(
			expect.objectContaining({
				round: 0,
				author: "claude",
				kind: "speech",
				text: "hi",
			}),
		);
		expect(byType.get("meeting.ended")).toBeDefined();
	});

	// @covers persistence:INV-006
	it("intra-process concurrent appends serialise into a contiguous seq run", async () => {
		const clock = new FakeClock();
		const ids = new FakeIdGen();
		const store = new InMemoryMeetingStore(clock);
		const { meeting, participants } = makeMeeting(clock, ids);
		const initial = await store.createMeeting({ meeting, participants });
		const baseSeq = initial.lastSeq;

		const N = 20;
		const messages = await Promise.all(
			Array.from({ length: N }, (_, i) =>
				store.appendMessage({
					meetingId: meeting.id,
					jobId: null,
					message: {
						id: ids.newMessageId(),
						round: 0,
						author: asParticipantId("claude"),
						kind: "speech",
						text: `parallel-${i}`,
						createdAt: clock.now(),
					},
				}),
			),
		);

		const seqs = messages.map((m) => m.seq).sort((a, b) => a - b);
		const expected = Array.from({ length: N }, (_, i) => baseSeq + 1 + i);
		expect(seqs).toEqual(expected);
		expect(new Set(seqs).size).toBe(N);
	});

	// @covers persistence:POL-001
	it("InMemoryMeetingStore source contains no filesystem imports", async () => {
		const { readFile } = await import("node:fs/promises");
		const { fileURLToPath } = await import("node:url");
		const here = fileURLToPath(new URL("./InMemoryMeetingStore.ts", import.meta.url));
		const src = await readFile(here, "utf8");
		expect(src).not.toMatch(/from\s+["']node:fs/);
		expect(src).not.toMatch(/require\(["']node:fs/);
		expect(src).not.toMatch(/from\s+["']node:net/);
		expect(src).not.toMatch(/from\s+["']node:child_process/);
	});

	// @covers persistence:BEH-010 @covers persistence:INV-009
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
