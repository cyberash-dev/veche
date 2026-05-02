import type { JobId, ParticipantId } from "../../../shared/types/ids.js";
import type { Instant } from "../../../shared/types/instant.js";
import type {
	AnyEvent,
	HumanTurnRequestedEvent,
	HumanTurnSubmittedEvent,
	SynthesisSubmittedEvent,
} from "../../persistence/domain/Event.js";
import type { Participant } from "../domain/Participant.js";

export interface HumanParticipantView {
	readonly id: ParticipantId;
	readonly displayName: string;
	readonly discussionRole: Participant["discussionRole"];
}

export interface HumanTurnView {
	readonly requestId: string;
	readonly round: number;
	readonly participant: HumanParticipantView;
	readonly agreeTargets: readonly HumanParticipantView[];
	readonly strengths: readonly [1, 2, 3];
	readonly canSkip: true;
	readonly canSteer: true;
}

export interface SynthesisView {
	readonly jobId: JobId;
	readonly text: string;
	readonly createdAt: Instant;
}

const participantView = (participant: Participant): HumanParticipantView => ({
	id: participant.id,
	displayName: participant.displayName,
	discussionRole: participant.discussionRole,
});

export const submissionForRequest = (
	events: readonly AnyEvent[],
	requestId: string,
): HumanTurnSubmittedEvent | null => {
	for (const event of events) {
		if (event.type === "human.turn.submitted" && event.payload.requestId === requestId) {
			return event;
		}
	}
	return null;
};

export const requestForId = (
	events: readonly AnyEvent[],
	requestId: string,
): HumanTurnRequestedEvent | null => {
	for (const event of events) {
		if (event.type === "human.turn.requested" && event.payload.requestId === requestId) {
			return event;
		}
	}
	return null;
};

export const pendingHumanTurn = (
	events: readonly AnyEvent[],
	participants: readonly Participant[],
	jobId: JobId,
): HumanTurnView | null => {
	const byId = new Map<ParticipantId, Participant>();
	for (const participant of participants) {
		byId.set(participant.id, participant);
	}
	for (const event of [...events].reverse()) {
		if (event.type !== "human.turn.requested" || event.payload.jobId !== jobId) {
			continue;
		}
		if (submissionForRequest(events, event.payload.requestId) !== null) {
			continue;
		}
		const participant = byId.get(event.payload.participantId);
		if (
			participant === undefined ||
			participant.participantKind !== "human" ||
			participant.status !== "active" ||
			!participant.isHumanParticipationEnabled
		) {
			return null;
		}
		const agreeTargets = event.payload.agreeTargets
			.map((id) => byId.get(id))
			.filter((target): target is Participant => target !== undefined)
			.map(participantView);
		return {
			requestId: event.payload.requestId,
			round: event.payload.roundNumber,
			participant: participantView(participant),
			agreeTargets,
			strengths: event.payload.strengths,
			canSkip: true,
			canSteer: true,
		};
	}
	return null;
};

export const synthesisForJob = (
	events: readonly AnyEvent[],
	jobId: JobId,
): SynthesisView | null => {
	const event = events.find(
		(item): item is SynthesisSubmittedEvent =>
			item.type === "synthesis.submitted" && item.payload.jobId === jobId,
	);
	if (event === undefined) {
		return null;
	}
	return {
		jobId,
		text: event.payload.text,
		createdAt: event.at,
	};
};
