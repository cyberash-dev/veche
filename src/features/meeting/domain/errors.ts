import { DomainError } from "../../../shared/errors/DomainError.js";

export class MeetingNotFound extends DomainError {
	constructor(meetingId: string) {
		super("MeetingNotFound", `Meeting ${meetingId} not found`, { meetingId });
	}
}

export class MeetingAlreadyExists extends DomainError {
	constructor(meetingId: string) {
		super("MeetingAlreadyExists", `Meeting ${meetingId} already exists`, { meetingId });
	}
}

export class MeetingAlreadyEnded extends DomainError {
	constructor(meetingId: string) {
		super("MeetingAlreadyEnded", `Meeting ${meetingId} is already ended`, { meetingId });
	}
}

export class MeetingBusy extends DomainError {
	constructor(meetingId: string, openJobId: string) {
		super("MeetingBusy", `Meeting ${meetingId} has an open job ${openJobId}`, {
			meetingId,
			openJobId,
		});
	}
}

export class NoActiveMembers extends DomainError {
	constructor(meetingId: string) {
		super("NoActiveMembers", `Meeting ${meetingId} has no active members`, { meetingId });
	}
}

export class ParticipantNotFound extends DomainError {
	constructor(meetingId: string, participantId: string) {
		super("ParticipantNotFound", `Participant ${participantId} not found in ${meetingId}`, {
			meetingId,
			participantId,
		});
	}
}

export class AddresseeNotFound extends DomainError {
	constructor(meetingId: string, participantId: string) {
		super(
			"AddresseeNotFound",
			`Addressee ${participantId} is not a member of meeting ${meetingId}`,
			{ meetingId, participantId },
		);
	}
}

export class DuplicateParticipantId extends DomainError {
	constructor(participantId: string) {
		super("DuplicateParticipantId", `Duplicate participant id ${participantId}`, {
			participantId,
		});
	}
}

export class JobNotFound extends DomainError {
	constructor(jobId: string) {
		super("JobNotFound", `Job ${jobId} not found`, { jobId });
	}
}

export class JobAlreadyExists extends DomainError {
	constructor(jobId: string) {
		super("JobAlreadyExists", `Job ${jobId} already exists`, { jobId });
	}
}

export class JobStateTransitionInvalid extends DomainError {
	constructor(jobId: string, from: string, to: string) {
		super("JobStateTransitionInvalid", `Job ${jobId} cannot transition from ${from} to ${to}`, {
			jobId,
			from,
			to,
		});
	}
}

export class JobAlreadyTerminal extends DomainError {
	constructor(jobId: string, status: string) {
		super("JobAlreadyTerminal", `Job ${jobId} is already terminal (${status})`, {
			jobId,
			status,
		});
	}
}

export class CursorInvalid extends DomainError {
	constructor(reason: string) {
		super("CursorInvalid", reason);
	}
}

export class StoreUnavailable extends DomainError {
	constructor(message: string, details: Record<string, unknown> = {}) {
		super("StoreUnavailable", message, details);
	}
}
