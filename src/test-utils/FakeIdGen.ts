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

export class FakeIdGen implements IdGenPort {
	private meetingCounter = 0;
	private jobCounter = 0;
	private messageCounter = 0;
	private sessionCounter = 0;
	private uuidCounter = 0;

	constructor(private readonly prefix = "test") {}

	newMeetingId(): MeetingId {
		this.meetingCounter += 1;
		return asMeetingId(`${this.prefix}-meeting-${this.meetingCounter}`);
	}

	newJobId(): JobId {
		this.jobCounter += 1;
		return asJobId(`${this.prefix}-job-${this.jobCounter}`);
	}

	newMessageId(): MessageId {
		this.messageCounter += 1;
		return asMessageId(`${this.prefix}-msg-${this.messageCounter}`);
	}

	newParticipantSessionId(): SessionId {
		this.sessionCounter += 1;
		return asSessionId(
			`00000000-0000-4000-8000-${String(this.sessionCounter).padStart(12, "0")}`,
		);
	}

	newUuid(): string {
		this.uuidCounter += 1;
		return `00000000-0000-4000-8000-u${String(this.uuidCounter).padStart(11, "0")}`;
	}
}
