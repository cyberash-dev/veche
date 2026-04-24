import { randomUUID } from "node:crypto";
import type { IdGenPort } from "../shared/ports/IdGenPort.js";
import {
	asJobId,
	asMeetingId,
	asMessageId,
	asSessionId,
	type JobId,
	type MeetingId,
	type MessageId,
	type SessionId,
} from "../shared/types/ids.js";

export class UuidIdGen implements IdGenPort {
	newMeetingId(): MeetingId {
		return asMeetingId(randomUUID());
	}
	newJobId(): JobId {
		return asJobId(randomUUID());
	}
	newMessageId(): MessageId {
		return asMessageId(randomUUID());
	}
	newParticipantSessionId(): SessionId {
		return asSessionId(randomUUID());
	}
	newUuid(): string {
		return randomUUID();
	}
}
