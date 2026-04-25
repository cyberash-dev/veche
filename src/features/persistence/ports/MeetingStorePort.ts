import type { JobId, MeetingId, ParticipantId } from "../../../shared/types/ids.js";
import type { Instant } from "../../../shared/types/instant.js";
import type { Cursor } from "../../meeting/domain/Cursor.js";
import type { Job, JobError, JobStatus, TerminationReason } from "../../meeting/domain/Job.js";
import type { Meeting } from "../../meeting/domain/Meeting.js";
import type { DraftMessage, Message } from "../../meeting/domain/Message.js";
import type { Participant } from "../../meeting/domain/Participant.js";
import type { AnyEvent, EventType } from "../domain/Event.js";

export interface MeetingSnapshot {
	readonly meeting: Meeting;
	readonly participants: readonly Participant[];
	readonly openJobs: readonly Job[];
	readonly lastSeq: number;
}

export interface MeetingSummary {
	readonly meetingId: MeetingId;
	readonly title: string;
	readonly status: "active" | "ended";
	readonly createdAt: Instant;
	readonly endedAt: Instant | null;
	readonly participants: ReadonlyArray<{
		readonly id: ParticipantId;
		readonly role: "facilitator" | "member";
		readonly adapter: "codex-cli" | "claude-code-cli" | null;
		readonly status: "active" | "dropped";
	}>;
	readonly lastSeq: number;
	readonly openJobCount: number;
}

export interface MessagePage {
	readonly messages: readonly Message[];
	readonly nextCursor: Cursor;
	readonly hasMore: boolean;
}

export interface ListMeetingsFilter {
	readonly status?: "active" | "ended";
	readonly createdAfter?: Instant;
	readonly createdBefore?: Instant;
	readonly limit: number;
	readonly cursor?: string;
}

export interface ListMeetingsResult {
	readonly summaries: readonly MeetingSummary[];
	readonly nextCursor: string | null;
}

export interface JobPatch {
	readonly status?: JobStatus;
	readonly startedAt?: Instant;
	readonly finishedAt?: Instant;
	readonly lastSeq?: number;
	readonly rounds?: number;
	readonly terminationReason?: TerminationReason;
	readonly error?: JobError;
	readonly cancelReason?: string;
}

export interface AppendSystemEventInput {
	readonly meetingId: MeetingId;
	readonly type: Exclude<EventType, "message.posted" | "meeting.created" | "participant.joined">;
	readonly payload: Record<string, unknown>;
	readonly at: Instant;
}

export interface MeetingStorePort {
	createMeeting(input: {
		meeting: Meeting;
		participants: readonly Participant[];
	}): Promise<MeetingSnapshot>;

	loadMeeting(meetingId: MeetingId): Promise<MeetingSnapshot>;

	listMeetings(filter: ListMeetingsFilter): Promise<ListMeetingsResult>;

	endMeeting(input: { meetingId: MeetingId; at: Instant }): Promise<MeetingSnapshot>;

	createJob(job: Job): Promise<Job>;
	loadJob(jobId: JobId): Promise<{ job: Job; meetingId: MeetingId }>;
	updateJob(input: { jobId: JobId; patch: JobPatch }): Promise<Job>;

	appendMessage(input: {
		meetingId: MeetingId;
		jobId: JobId | null;
		message: DraftMessage;
	}): Promise<Message>;

	appendSystemEvent(input: AppendSystemEventInput): Promise<{ seq: number }>;

	readMessagesSince(input: {
		meetingId: MeetingId;
		cursor?: string;
		limit: number;
	}): Promise<MessagePage>;

	markParticipantDropped(input: {
		meetingId: MeetingId;
		participantId: ParticipantId;
		reason: string;
		error: JobError | null;
		jobId: JobId | null;
		at: Instant;
	}): Promise<void>;

	/** Awaits until an event with seq > cursor.seq is appended, or the timeout elapses. */
	watchNewEvents(input: {
		meetingId: MeetingId;
		cursor?: string;
		timeoutMs: number;
	}): Promise<void>;

	/**
	 * Optional. Re-read on-disk state to pick up changes made by another process. Same-process
	 * adapters (e.g. InMemoryStore) leave this unimplemented. Cross-process readers (the watch
	 * server) call this before each poll cycle so `listMeetings` / `loadMeeting` /
	 * `readMessagesSince` reflect the current store contents.
	 */
	refresh?(): Promise<void>;

	/** For tests and debug tooling — full event stream for a meeting. */
	readAllEvents?(meetingId: MeetingId): Promise<readonly AnyEvent[]>;
}
