import { ValidationError } from "../../../shared/errors/DomainError.js";
import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import { asParticipantId, type JobId, type MeetingId } from "../../../shared/types/ids.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import { ParticipantNotFound } from "../domain/errors.js";

export interface SetHumanParticipationCommand {
	readonly meetingId: MeetingId;
	readonly participantId: string;
	readonly enabled: boolean;
	readonly jobId?: JobId;
}

export interface SetHumanParticipationResult {
	readonly meetingId: MeetingId;
	readonly participantId: string;
	readonly enabled: boolean;
}

export class SetHumanParticipationUseCase {
	constructor(
		private readonly deps: {
			readonly store: MeetingStorePort;
			readonly clock: ClockPort;
		},
	) {}

	async execute(command: SetHumanParticipationCommand): Promise<SetHumanParticipationResult> {
		const { store, clock } = this.deps;
		await store.refresh?.();
		const snapshot = await store.loadMeeting(command.meetingId);
		const participant = snapshot.participants.find((item) => item.id === command.participantId);
		if (participant === undefined) {
			throw new ParticipantNotFound(command.meetingId, command.participantId);
		}
		if (participant.participantKind !== "human") {
			throw new ValidationError("participantId must identify a human participant");
		}
		await store.appendSystemEvent({
			meetingId: command.meetingId,
			type: "human.participation.set",
			payload: {
				participantId: asParticipantId(command.participantId),
				enabled: command.enabled,
				jobId: command.jobId ?? null,
			},
			at: clock.now(),
		});
		return {
			meetingId: command.meetingId,
			participantId: command.participantId,
			enabled: command.enabled,
		};
	}
}
