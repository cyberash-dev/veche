import type { JobId, MeetingId, MessageId, ParticipantId } from "../../../shared/types/ids.js";
import type { Instant } from "../../../shared/types/instant.js";
import type { JobError, TerminationReason } from "../../meeting/domain/Job.js";
import type { MessageKind } from "../../meeting/domain/Message.js";
import type { AdapterKind, ParticipantRole } from "../../meeting/domain/Participant.js";

export type EventType =
	| "meeting.created"
	| "participant.joined"
	| "job.started"
	| "round.started"
	| "message.posted"
	| "round.completed"
	| "participant.dropped"
	| "job.completed"
	| "job.failed"
	| "job.cancelled"
	| "meeting.ended";

export interface EventEnvelope<T extends EventType = EventType, P = unknown> {
	readonly meetingId: MeetingId;
	readonly seq: number;
	readonly type: T;
	readonly at: Instant;
	readonly payload: P;
}

export interface ParticipantSnapshot {
	readonly id: ParticipantId;
	readonly role: ParticipantRole;
	readonly displayName: string;
	readonly adapter: AdapterKind | null;
	readonly profile: string | null;
	readonly model: string | null;
	readonly workdir: string | null;
	readonly systemPrompt: string | null;
	readonly extraFlags: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly sessionId: string | null;
}

export type MeetingCreatedEvent = EventEnvelope<
	"meeting.created",
	{ readonly title: string; readonly defaultMaxRounds: number; readonly createdAt: Instant }
>;

export type ParticipantJoinedEvent = EventEnvelope<
	"participant.joined",
	{ readonly participant: ParticipantSnapshot }
>;

export type JobStartedEvent = EventEnvelope<
	"job.started",
	{
		readonly jobId: JobId;
		readonly maxRounds: number;
		readonly turnTimeoutMs: number;
		readonly addressees: readonly string[] | null;
	}
>;

export type RoundStartedEvent = EventEnvelope<
	"round.started",
	{
		readonly jobId: JobId;
		readonly roundNumber: number;
		readonly activeParticipantIds: readonly string[];
	}
>;

export type MessagePostedEvent = EventEnvelope<
	"message.posted",
	{
		readonly messageId: MessageId;
		readonly round: number;
		readonly author: string;
		readonly kind: MessageKind;
		readonly text: string;
		readonly jobId: JobId | null;
	}
>;

export type RoundCompletedEvent = EventEnvelope<
	"round.completed",
	{
		readonly jobId: JobId;
		readonly roundNumber: number;
		readonly passedParticipantIds: readonly string[];
	}
>;

export type ParticipantDroppedEvent = EventEnvelope<
	"participant.dropped",
	{
		readonly participantId: ParticipantId;
		readonly reason: string;
		readonly error: JobError | null;
		readonly jobId: JobId | null;
	}
>;

export type JobCompletedEvent = EventEnvelope<
	"job.completed",
	{
		readonly jobId: JobId;
		readonly terminationReason: TerminationReason;
		readonly lastSeq: number;
		readonly rounds: number;
	}
>;

export type JobFailedEvent = EventEnvelope<
	"job.failed",
	{ readonly jobId: JobId; readonly error: JobError }
>;

export type JobCancelledEvent = EventEnvelope<
	"job.cancelled",
	{ readonly jobId: JobId; readonly cancelReason: string }
>;

export type MeetingEndedEvent = EventEnvelope<"meeting.ended", Record<string, never>>;

export type AnyEvent =
	| MeetingCreatedEvent
	| ParticipantJoinedEvent
	| JobStartedEvent
	| RoundStartedEvent
	| MessagePostedEvent
	| RoundCompletedEvent
	| ParticipantDroppedEvent
	| JobCompletedEvent
	| JobFailedEvent
	| JobCancelledEvent
	| MeetingEndedEvent;
