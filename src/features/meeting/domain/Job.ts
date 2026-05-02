import type { JobId, MeetingId } from "../../../shared/types/ids.js";
import type { Instant } from "../../../shared/types/instant.js";

export type JobStatus =
	| "queued"
	| "running"
	| "waiting_for_human"
	| "completed"
	| "failed"
	| "cancelled";

export type TerminationReason = "all-passed" | "max-rounds" | "no-active-members" | "cancelled";

export interface JobError {
	readonly code: string;
	readonly message: string;
}

export interface Job {
	readonly id: JobId;
	readonly meetingId: MeetingId;
	readonly status: JobStatus;
	readonly createdAt: Instant;
	readonly startedAt: Instant | null;
	readonly finishedAt: Instant | null;
	readonly maxRounds: number;
	readonly turnTimeoutMs: number;
	readonly addressees: readonly string[] | null;
	readonly lastSeq: number;
	/** Number of Rounds executed by this Job (not log position). 0 while Round 0 only. */
	readonly rounds: number;
	readonly terminationReason: TerminationReason | null;
	readonly error: JobError | null;
	readonly cancelReason: string | null;
}
