import type { ClockPort } from "../../../../shared/ports/ClockPort.js";
import type { JobId, MeetingId, ParticipantId } from "../../../../shared/types/ids.js";
import type { Instant } from "../../../../shared/types/instant.js";
import {
	type Cursor,
	decodeCursor,
	encodeCursor,
	INITIAL_CURSOR,
} from "../../../meeting/domain/Cursor.js";
import {
	CursorInvalid,
	JobAlreadyExists,
	JobNotFound,
	JobStateTransitionInvalid,
	MeetingAlreadyEnded,
	MeetingAlreadyExists,
	MeetingNotFound,
	ParticipantNotFound,
} from "../../../meeting/domain/errors.js";
import type { Job, JobStatus } from "../../../meeting/domain/Job.js";
import type { Meeting } from "../../../meeting/domain/Meeting.js";
import type { DraftMessage, Message } from "../../../meeting/domain/Message.js";
import type { Participant } from "../../../meeting/domain/Participant.js";
import type { AnyEvent } from "../../domain/Event.js";
import type {
	AppendSystemEventInput,
	JobPatch,
	ListMeetingsFilter,
	ListMeetingsResult,
	MeetingSnapshot,
	MeetingStorePort,
	MeetingSummary,
	MessagePage,
} from "../../ports/MeetingStorePort.js";

interface MeetingRecord {
	meeting: Meeting;
	participants: Map<ParticipantId, Participant>;
	events: AnyEvent[];
	jobs: Map<JobId, Job>;
	watchers: Set<Watcher>;
}

interface Watcher {
	sinceSeq: number;
	resolve: () => void;
	timer: ReturnType<typeof setTimeout>;
}

const TERMINAL_JOB_STATES: ReadonlySet<JobStatus> = new Set(["completed", "failed", "cancelled"]);

const isValidTransition = (from: JobStatus, to: JobStatus): boolean => {
	if (from === to) {
		return true;
	}
	switch (from) {
		case "queued":
			return to === "running" || to === "cancelled" || to === "failed";
		case "running":
			return to === "completed" || to === "failed" || to === "cancelled";
		default:
			return false;
	}
};

const parseCursor = (cursor: string | undefined): number => {
	if (cursor === undefined) {
		return INITIAL_CURSOR.seq;
	}
	try {
		return decodeCursor(cursor).seq;
	} catch {
		throw new CursorInvalid(`cannot decode cursor`);
	}
};

export class InMemoryMeetingStore implements MeetingStorePort {
	private readonly meetings = new Map<MeetingId, MeetingRecord>();
	private readonly jobIndex = new Map<JobId, MeetingId>();

	constructor(private readonly clock: ClockPort) {}

	async createMeeting(input: {
		meeting: Meeting;
		participants: readonly Participant[];
	}): Promise<MeetingSnapshot> {
		if (this.meetings.has(input.meeting.id)) {
			throw new MeetingAlreadyExists(input.meeting.id);
		}
		const record: MeetingRecord = {
			meeting: input.meeting,
			participants: new Map(),
			events: [],
			jobs: new Map(),
			watchers: new Set(),
		};
		this.meetings.set(input.meeting.id, record);

		this.appendEvent(record, {
			type: "meeting.created",
			payload: {
				title: input.meeting.title,
				defaultMaxRounds: input.meeting.defaultMaxRounds,
				createdAt: input.meeting.createdAt,
			},
		});
		for (const p of input.participants) {
			record.participants.set(p.id, p);
			this.appendEvent(record, {
				type: "participant.joined",
				payload: {
					participant: {
						id: p.id,
						role: p.role,
						displayName: p.displayName,
						adapter: p.adapter,
						profile: p.profile,
						model: p.model,
						workdir: p.workdir,
						systemPrompt: p.systemPrompt,
						extraFlags: p.extraFlags,
						env: p.env,
						sessionId: p.sessionId,
					},
				},
			});
		}
		return this.toSnapshot(record);
	}

	async loadMeeting(meetingId: MeetingId): Promise<MeetingSnapshot> {
		const record = this.must(meetingId);
		return this.toSnapshot(record);
	}

	async listMeetings(filter: ListMeetingsFilter): Promise<ListMeetingsResult> {
		const summaries: MeetingSummary[] = [];
		for (const record of this.meetings.values()) {
			if (filter.status && record.meeting.status !== filter.status) {
				continue;
			}
			if (filter.createdAfter && record.meeting.createdAt <= filter.createdAfter) {
				continue;
			}
			if (filter.createdBefore && record.meeting.createdAt >= filter.createdBefore) {
				continue;
			}
			const openJobCount = Array.from(record.jobs.values()).filter(
				(j) => j.status === "queued" || j.status === "running",
			).length;
			summaries.push({
				meetingId: record.meeting.id,
				title: record.meeting.title,
				status: record.meeting.status,
				createdAt: record.meeting.createdAt,
				endedAt: record.meeting.endedAt,
				participants: Array.from(record.participants.values()).map((p) => ({
					id: p.id,
					role: p.role,
					adapter: p.adapter,
					status: p.status,
				})),
				lastSeq: record.events.length - 1,
				openJobCount,
			});
		}
		summaries.sort((a, b) => {
			if (a.createdAt > b.createdAt) {
				return -1;
			}
			if (a.createdAt < b.createdAt) {
				return 1;
			}
			return a.meetingId.localeCompare(b.meetingId);
		});
		const startIndex = filter.cursor ? this.decodeListCursor(filter.cursor) : 0;
		const slice = summaries.slice(startIndex, startIndex + filter.limit);
		const nextIndex = startIndex + slice.length;
		const nextCursor = nextIndex < summaries.length ? this.encodeListCursor(nextIndex) : null;
		return { summaries: slice, nextCursor };
	}

	async endMeeting(input: { meetingId: MeetingId; at: Instant }): Promise<MeetingSnapshot> {
		const record = this.must(input.meetingId);
		if (record.meeting.status === "ended") {
			throw new MeetingAlreadyEnded(input.meetingId);
		}
		record.meeting = { ...record.meeting, status: "ended", endedAt: input.at };
		this.appendEvent(record, { type: "meeting.ended", payload: {} });
		return this.toSnapshot(record);
	}

	async createJob(job: Job): Promise<Job> {
		const record = this.must(job.meetingId);
		if (record.meeting.status === "ended") {
			throw new MeetingAlreadyEnded(job.meetingId);
		}
		if (record.jobs.has(job.id)) {
			throw new JobAlreadyExists(job.id);
		}
		const hasOpen = Array.from(record.jobs.values()).some(
			(j) => j.status === "queued" || j.status === "running",
		);
		if (hasOpen) {
			throw new JobStateTransitionInvalid(job.id, "n/a", "queued");
		}
		record.jobs.set(job.id, job);
		this.jobIndex.set(job.id, job.meetingId);
		return job;
	}

	async loadJob(jobId: JobId): Promise<{ job: Job; meetingId: MeetingId }> {
		const meetingId = this.jobIndex.get(jobId);
		if (!meetingId) {
			throw new JobNotFound(jobId);
		}
		const record = this.must(meetingId);
		const job = record.jobs.get(jobId);
		if (!job) {
			throw new JobNotFound(jobId);
		}
		return { job, meetingId };
	}

	async updateJob(input: { jobId: JobId; patch: JobPatch }): Promise<Job> {
		const { job, meetingId } = await this.loadJob(input.jobId);
		const record = this.must(meetingId);
		const patch = input.patch;
		if (patch.status && !isValidTransition(job.status, patch.status)) {
			throw new JobStateTransitionInvalid(job.id, job.status, patch.status);
		}
		if (TERMINAL_JOB_STATES.has(job.status)) {
			// Only allow no-op updates on terminal jobs.
			if (patch.status && patch.status !== job.status) {
				throw new JobStateTransitionInvalid(job.id, job.status, patch.status);
			}
		}
		const updated: Job = {
			...job,
			...(patch.status !== undefined ? { status: patch.status } : {}),
			...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
			...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
			...(patch.lastSeq !== undefined ? { lastSeq: patch.lastSeq } : {}),
			...(patch.rounds !== undefined ? { rounds: patch.rounds } : {}),
			...(patch.terminationReason !== undefined
				? { terminationReason: patch.terminationReason }
				: {}),
			...(patch.error !== undefined ? { error: patch.error } : {}),
			...(patch.cancelReason !== undefined ? { cancelReason: patch.cancelReason } : {}),
		};
		record.jobs.set(updated.id, updated);
		return updated;
	}

	async appendMessage(input: {
		meetingId: MeetingId;
		jobId: JobId | null;
		message: DraftMessage;
	}): Promise<Message> {
		const record = this.must(input.meetingId);
		if (record.meeting.status === "ended") {
			throw new MeetingAlreadyEnded(input.meetingId);
		}
		const event = this.appendEvent(record, {
			type: "message.posted",
			payload: {
				messageId: input.message.id,
				round: input.message.round,
				author: input.message.author,
				kind: input.message.kind,
				text: input.message.text,
				jobId: input.jobId,
			},
		});
		return {
			id: input.message.id,
			meetingId: input.meetingId,
			seq: event.seq,
			round: input.message.round,
			author: input.message.author,
			kind: input.message.kind,
			text: input.message.text,
			createdAt: input.message.createdAt,
		};
	}

	async appendSystemEvent(input: AppendSystemEventInput): Promise<{ seq: number }> {
		const record = this.must(input.meetingId);
		if (record.meeting.status === "ended" && input.type !== "meeting.ended") {
			throw new MeetingAlreadyEnded(input.meetingId);
		}
		const event = this.appendEvent(record, {
			type: input.type,
			payload: input.payload,
		});
		return { seq: event.seq };
	}

	async readMessagesSince(input: {
		meetingId: MeetingId;
		cursor?: string;
		limit: number;
	}): Promise<MessagePage> {
		const record = this.must(input.meetingId);
		const sinceSeq = parseCursor(input.cursor);
		const messages: Message[] = [];
		let lastScannedSeq = sinceSeq;
		let scanned = 0;
		for (const event of record.events) {
			if (event.seq <= sinceSeq) {
				continue;
			}
			scanned += 1;
			lastScannedSeq = event.seq;
			if (event.type === "message.posted") {
				messages.push({
					id: event.payload.messageId,
					meetingId: input.meetingId,
					seq: event.seq,
					round: event.payload.round,
					author: event.payload.author as Message["author"],
					kind: event.payload.kind,
					text: event.payload.text,
					createdAt: event.at,
				});
				if (messages.length >= input.limit) {
					break;
				}
			}
		}
		const hasMore = lastScannedSeq < record.events.length - 1;
		const nextCursor: Cursor = encodeCursor({ seq: lastScannedSeq });
		void scanned;
		return { messages, nextCursor, hasMore };
	}

	async markParticipantDropped(input: {
		meetingId: MeetingId;
		participantId: ParticipantId;
		reason: string;
		error: Job["error"];
		jobId: JobId | null;
		at: Instant;
	}): Promise<void> {
		const record = this.must(input.meetingId);
		const participant = record.participants.get(input.participantId);
		if (!participant) {
			throw new ParticipantNotFound(input.meetingId, input.participantId);
		}
		record.participants.set(input.participantId, {
			...participant,
			status: "dropped",
			droppedAt: input.at,
			droppedReason: input.reason,
		});
		this.appendEvent(record, {
			type: "participant.dropped",
			payload: {
				participantId: input.participantId,
				reason: input.reason,
				error: input.error,
				jobId: input.jobId,
			},
		});
	}

	async watchNewEvents(input: {
		meetingId: MeetingId;
		cursor?: string;
		timeoutMs: number;
	}): Promise<void> {
		const record = this.must(input.meetingId);
		const sinceSeq = parseCursor(input.cursor);
		const latest = record.events[record.events.length - 1];
		if (latest !== undefined && latest.seq > sinceSeq) {
			return;
		}
		await new Promise<void>((resolve) => {
			const watcher: Watcher = {
				sinceSeq,
				resolve,
				timer: setTimeout(
					() => {
						record.watchers.delete(watcher);
						resolve();
					},
					Math.max(0, input.timeoutMs),
				),
			};
			record.watchers.add(watcher);
		});
	}

	async readAllEvents(meetingId: MeetingId): Promise<readonly AnyEvent[]> {
		const record = this.must(meetingId);
		return [...record.events];
	}

	// ---------- helpers ----------

	private must(meetingId: MeetingId): MeetingRecord {
		const rec = this.meetings.get(meetingId);
		if (!rec) {
			throw new MeetingNotFound(meetingId);
		}
		return rec;
	}

	private appendEvent<T extends AnyEvent["type"]>(
		record: MeetingRecord,
		input: { type: T; payload: unknown },
	): AnyEvent {
		const seq = record.events.length;
		const event = {
			meetingId: record.meeting.id,
			seq,
			type: input.type,
			at: this.clock.now(),
			payload: input.payload,
		} as unknown as AnyEvent;
		record.events.push(event);
		// Wake watchers whose sinceSeq < seq.
		for (const w of Array.from(record.watchers)) {
			if (w.sinceSeq < seq) {
				clearTimeout(w.timer);
				record.watchers.delete(w);
				w.resolve();
			}
		}
		return event;
	}

	private toSnapshot(record: MeetingRecord): MeetingSnapshot {
		return {
			meeting: record.meeting,
			participants: Array.from(record.participants.values()),
			openJobs: Array.from(record.jobs.values()).filter(
				(j) => j.status === "queued" || j.status === "running",
			),
			lastSeq: record.events.length - 1,
		};
	}

	private encodeListCursor(index: number): string {
		return Buffer.from(`list:${index}`, "utf8").toString("base64url");
	}

	private decodeListCursor(raw: string): number {
		try {
			const decoded = Buffer.from(raw, "base64url").toString("utf8");
			if (!decoded.startsWith("list:")) {
				throw new Error("bad prefix");
			}
			const n = Number.parseInt(decoded.slice(5), 10);
			if (!Number.isFinite(n) || n < 0) {
				throw new Error("bad index");
			}
			return n;
		} catch {
			throw new CursorInvalid("cannot decode list cursor");
		}
	}
}
