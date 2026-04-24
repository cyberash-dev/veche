import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { IdGenPort } from "../../../shared/ports/IdGenPort.js";
import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import type { JobId, ParticipantId } from "../../../shared/types/ids.js";
import type { Session } from "../../agent-integration/domain/Session.js";
import type { AgentAdapterPort } from "../../agent-integration/ports/AgentAdapterPort.js";
import type { JobError } from "../../meeting/domain/Job.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import type { DiscussionState } from "../domain/DiscussionState.js";

export interface HandleAgentFailureInput {
	readonly state: DiscussionState;
	readonly participantId: ParticipantId;
	readonly session: Session;
	readonly jobId: JobId;
	readonly error: JobError & { readonly retryable?: boolean };
	readonly attempts: number;
}

export class HandleAgentFailureUseCase {
	constructor(
		private readonly deps: {
			readonly store: MeetingStorePort;
			readonly clock: ClockPort;
			readonly ids: IdGenPort;
			readonly logger: LoggerPort;
			readonly adapterFor: (participantId: ParticipantId) => AgentAdapterPort;
		},
	) {}

	async execute(input: HandleAgentFailureInput): Promise<void> {
		const { store, clock, ids, logger, adapterFor } = this.deps;
		const now = clock.now();
		await store.markParticipantDropped({
			meetingId: input.state.meetingId,
			participantId: input.participantId,
			reason: input.error.code,
			error: { code: input.error.code, message: input.error.message },
			jobId: input.jobId,
			at: now,
		});
		const systemMessage = `participant:${input.participantId} dropped:${input.error.code} message:${input.error.message}`;
		const appended = await store.appendMessage({
			meetingId: input.state.meetingId,
			jobId: input.jobId,
			message: {
				id: ids.newMessageId(),
				round: input.state.roundNumber,
				author: "system",
				kind: "system",
				text: systemMessage,
				createdAt: now,
			},
		});
		input.state.lastSeq = appended.seq;
		input.state.droppedThisJob.add(input.participantId);
		input.state.pendingPass.delete(input.participantId);
		try {
			await adapterFor(input.participantId).closeSession(input.session);
		} catch (err) {
			logger.warn("adapter.closeSession.failed", {
				participantId: input.participantId,
				error: (err as Error).message,
			});
		}
	}
}
