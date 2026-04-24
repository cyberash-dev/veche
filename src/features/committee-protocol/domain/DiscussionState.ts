import type { JobId, MeetingId, ParticipantId } from "../../../shared/types/ids.js";
import type { TerminationReason } from "../../meeting/domain/Job.js";

export interface DiscussionState {
	readonly jobId: JobId;
	readonly meetingId: MeetingId;
	readonly maxRounds: number;
	roundNumber: number;
	readonly pendingPass: Set<ParticipantId>;
	readonly droppedThisJob: Set<ParticipantId>;
	terminationReason: TerminationReason | null;
	lastSeq: number;
}
