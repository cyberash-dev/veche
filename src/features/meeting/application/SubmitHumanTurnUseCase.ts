import { ValidationError } from "../../../shared/errors/DomainError.js";
import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { IdGenPort } from "../../../shared/ports/IdGenPort.js";
import { asParticipantId, type JobId } from "../../../shared/types/ids.js";
import type { HumanTurnAction } from "../../persistence/domain/Event.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import {
	HumanTurnAlreadySubmitted,
	HumanTurnNotFound,
	ParticipantNotFound,
} from "../domain/errors.js";
import type { Message } from "../domain/Message.js";
import { MaxTextLengthBytes } from "./constants.js";
import { pendingHumanTurn, requestForId, submissionForRequest } from "./humanTurnState.js";

export interface SubmitHumanTurnCommand {
	readonly jobId: JobId;
	readonly requestId: string;
	readonly action: HumanTurnAction;
	readonly targetParticipantId?: string;
	readonly strength?: 1 | 2 | 3;
	readonly text?: string;
	readonly auto?: boolean;
}

export interface SubmitHumanTurnResult {
	readonly jobId: JobId;
	readonly requestId: string;
	readonly accepted: true;
	readonly messageId: Message["id"];
}

export class SubmitHumanTurnUseCase {
	constructor(
		private readonly deps: {
			readonly store: MeetingStorePort;
			readonly clock: ClockPort;
			readonly ids: IdGenPort;
		},
	) {}

	async execute(command: SubmitHumanTurnCommand): Promise<SubmitHumanTurnResult> {
		const { store, clock, ids } = this.deps;
		await store.refresh?.();
		const { job, meetingId } = await store.loadJob(command.jobId);
		if (!store.readAllEvents) {
			throw new ValidationError("store does not expose readAllEvents");
		}
		const snapshot = await store.loadMeeting(meetingId);
		const events = await store.readAllEvents(meetingId);
		const request = requestForId(events, command.requestId);
		if (request === null || request.payload.jobId !== command.jobId) {
			throw new HumanTurnNotFound(command.requestId);
		}
		if (submissionForRequest(events, command.requestId) !== null) {
			throw new HumanTurnAlreadySubmitted(command.requestId);
		}
		if (
			pendingHumanTurn(events, snapshot.participants, command.jobId)?.requestId !==
			command.requestId
		) {
			throw new HumanTurnNotFound(command.requestId);
		}
		const participant = snapshot.participants.find(
			(item) => item.id === request.payload.participantId,
		);
		if (participant === undefined) {
			throw new ParticipantNotFound(meetingId, request.payload.participantId);
		}
		const messageText = this.messageText(command, request.payload.agreeTargets);
		const kind = command.action === "skip" ? "pass" : "speech";
		const message = await store.appendMessage({
			meetingId,
			jobId: job.id,
			message: {
				id: ids.newMessageId(),
				round: request.payload.roundNumber,
				author: participant.id,
				kind,
				text: kind === "pass" ? "<PASS/>" : messageText,
				createdAt: clock.now(),
			},
		});
		await store.appendSystemEvent({
			meetingId,
			type: "human.turn.submitted",
			payload: {
				jobId: job.id,
				requestId: command.requestId,
				roundNumber: request.payload.roundNumber,
				participantId: participant.id,
				action: command.action,
				...(command.targetParticipantId !== undefined
					? { targetParticipantId: asParticipantId(command.targetParticipantId) }
					: {}),
				...(command.strength !== undefined ? { strength: command.strength } : {}),
				...(command.action === "steer" ? { text: messageText } : {}),
				messageId: message.id,
				messageSeq: message.seq,
				auto: command.auto === true,
			},
			at: clock.now(),
		});
		return {
			jobId: job.id,
			requestId: command.requestId,
			accepted: true,
			messageId: message.id,
		};
	}

	private messageText(command: SubmitHumanTurnCommand, agreeTargets: readonly string[]): string {
		if (command.action === "skip") {
			return "<PASS/>";
		}
		if (command.action === "agree") {
			if (command.targetParticipantId === undefined) {
				throw new ValidationError("targetParticipantId is required for agree");
			}
			if (!agreeTargets.includes(asParticipantId(command.targetParticipantId))) {
				throw new ValidationError("targetParticipantId is not an agree target");
			}
			if (command.strength !== 1 && command.strength !== 2 && command.strength !== 3) {
				throw new ValidationError("strength must be 1, 2, or 3");
			}
			return `Agree with ${command.targetParticipantId} (strength ${command.strength}/3).`;
		}
		if (command.action === "steer") {
			const text = command.text?.trim() ?? "";
			if (text.length === 0) {
				throw new ValidationError("text is required for steer");
			}
			if (Buffer.byteLength(text, "utf8") > MaxTextLengthBytes) {
				throw new ValidationError("text exceeds 32 KiB");
			}
			return text;
		}
		throw new ValidationError("action must be agree, skip, or steer");
	}
}
