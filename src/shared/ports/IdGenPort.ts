import type { JobId, MeetingId, MessageId, SessionId } from "../types/ids.js";

export interface IdGenPort {
	newMeetingId(): MeetingId;
	newMessageId(): MessageId;
	newJobId(): JobId;
	newParticipantSessionId(): SessionId;
	newUuid(): string;
}
