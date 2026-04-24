import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { IdGenPort } from "../../../shared/ports/IdGenPort.js";
import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import type { ParticipantId } from "../../../shared/types/ids.js";
import type { Session } from "../../agent-integration/domain/Session.js";
import type { MessageView } from "../../agent-integration/domain/Turn.js";
import type { AgentAdapterPort } from "../../agent-integration/ports/AgentAdapterPort.js";
import type { Job } from "../../meeting/domain/Job.js";
import type { Message } from "../../meeting/domain/Message.js";
import type { Participant } from "../../meeting/domain/Participant.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import type { DiscussionState } from "../domain/DiscussionState.js";
import type { DispatchTurnUseCase } from "./DispatchTurnUseCase.js";
import type { HandleAgentFailureUseCase } from "./HandleAgentFailureUseCase.js";

export interface RunRoundDeps {
	readonly store: MeetingStorePort;
	readonly clock: ClockPort;
	readonly ids: IdGenPort;
	readonly logger: LoggerPort;
	readonly adapterFor: (participantId: ParticipantId) => AgentAdapterPort;
	readonly dispatch: DispatchTurnUseCase;
	readonly handleFailure: HandleAgentFailureUseCase;
}

export interface RunRoundInput {
	readonly job: Job;
	readonly state: DiscussionState;
	readonly participants: ReadonlyMap<ParticipantId, Participant>;
	readonly sessions: ReadonlyMap<ParticipantId, Session>;
	/**
	 * The full prior transcript-so-far in `seq` order. `buildPrefixForParticipant` narrows it
	 * per Member by `lastRound` + author-not-self.
	 */
	readonly priorMessages: readonly Message[];
	/**
	 * Map from `ParticipantId` to the round in which that Member most recently spoke (or `-1`
	 * before any). Used by `buildPrefixForParticipant` to send a Member every Message from
	 * other Members emitted in rounds the Member has not yet seen. The runner mutates this
	 * map as Turns are appended.
	 */
	readonly participantLastRound: Map<ParticipantId, number>;
	readonly cancellationSignal: AbortSignal;
}

export class RunRoundUseCase {
	constructor(private readonly deps: RunRoundDeps) {}

	async execute(input: RunRoundInput): Promise<void> {
		const { store, clock, ids, dispatch, handleFailure } = this.deps;
		const activeMembers = this.selectActiveMembers(input);
		if (activeMembers.length === 0) {
			return;
		}
		input.state.roundNumber += 1;
		const now = clock.now();
		await store.appendSystemEvent({
			meetingId: input.state.meetingId,
			type: "round.started",
			payload: {
				jobId: input.job.id,
				roundNumber: input.state.roundNumber,
				activeParticipantIds: activeMembers,
			},
			at: now,
		});

		const outcomes = await Promise.allSettled(
			activeMembers.map(async (participantId) => {
				const participant = input.participants.get(participantId)!;
				const session = input.sessions.get(participantId)!;
				const lastRound = input.participantLastRound.get(participantId) ?? -1;
				const prefix = this.buildPrefixForParticipant(
					participantId,
					input.priorMessages,
					lastRound,
				);
				const result = await dispatch.execute({
					session,
					participant,
					transcriptPrefix: prefix,
					roundNumber: input.state.roundNumber,
					timeoutMs: input.job.turnTimeoutMs,
					cancellationSignal: input.cancellationSignal,
				});
				return { participantId, session, result } as const;
			}),
		);

		// Deterministic processing order: ascending participantId.
		const processed = outcomes
			.map((o, idx) => ({ o, participantId: activeMembers[idx]! }))
			.sort((a, b) => a.participantId.localeCompare(b.participantId));

		for (const { o, participantId } of processed) {
			if (o.status === "rejected") {
				await handleFailure.execute({
					state: input.state,
					participantId,
					session: input.sessions.get(participantId)!,
					jobId: input.job.id,
					error: {
						code: "AdapterInvocationError",
						message: (o.reason as Error).message,
						retryable: false,
					},
					attempts: 1,
				});
				continue;
			}
			const { result, session } = o.value;
			if (result.kind === "failure") {
				await handleFailure.execute({
					state: input.state,
					participantId,
					session,
					jobId: input.job.id,
					error: result.error,
					attempts: 1,
				});
				continue;
			}
			// Update providerRef on session map only; DispatchTurn already returns the latest.
			if (result.providerRef && session.providerRef !== result.providerRef) {
				(input.sessions as Map<ParticipantId, Session>).set(participantId, {
					...session,
					providerRef: result.providerRef,
				});
			}
			const kind = result.kind;
			const text = result.kind === "pass" ? "<PASS/>" : result.text;
			const stamped = clock.now();
			const appended = await store.appendMessage({
				meetingId: input.state.meetingId,
				jobId: input.job.id,
				message: {
					id: ids.newMessageId(),
					round: input.state.roundNumber,
					author: participantId,
					kind,
					text,
					createdAt: stamped,
				},
			});
			input.state.lastSeq = appended.seq;
			input.participantLastRound.set(participantId, input.state.roundNumber);
			if (kind === "pass") {
				input.state.pendingPass.add(participantId);
			} else {
				input.state.pendingPass.delete(participantId);
			}
		}

		// Emit round.completed with the set that passed this round.
		const passedThisRound = activeMembers.filter((id) => input.state.pendingPass.has(id));
		await store.appendSystemEvent({
			meetingId: input.state.meetingId,
			type: "round.completed",
			payload: {
				jobId: input.job.id,
				roundNumber: input.state.roundNumber,
				passedParticipantIds: passedThisRound,
			},
			at: clock.now(),
		});
	}

	private selectActiveMembers(input: RunRoundInput): ParticipantId[] {
		const ids: ParticipantId[] = [];
		for (const p of input.participants.values()) {
			if (p.role !== "member") {
				continue;
			}
			if (p.status === "dropped") {
				continue;
			}
			if (input.state.droppedThisJob.has(p.id)) {
				continue;
			}
			ids.push(p.id);
		}
		ids.sort((a, b) => a.localeCompare(b));
		return ids;
	}

	/**
	 * Bounded delta: every Message from other Members in rounds the Member has not yet seen.
	 * A Member who last spoke in round R sees, on its next Turn, every Message with
	 * `round >= R` authored by anyone else. On the first Turn (`lastRound = -1`) this is the
	 * facilitator's opening Message (round 0). On Round N+1 this is every other Member's
	 * reply from Round N. Older context is retained by the adapter's provider session — see
	 * spec `spec/features/committee-protocol/run-round.usecase.md` step 4a.
	 */
	private buildPrefixForParticipant(
		self: ParticipantId,
		allMessages: readonly Message[],
		lastRound: number,
	): MessageView[] {
		const views: MessageView[] = [];
		for (const m of allMessages) {
			if (m.round < lastRound) {
				continue;
			}
			if (m.author === self) {
				continue;
			}
			if (m.kind === "speech" || m.kind === "pass" || m.kind === "system") {
				views.push({
					authorId: String(m.author),
					authorRole:
						m.author === "system" ? "system" : m.round === 0 ? "facilitator" : "member",
					round: m.round,
					text: m.text,
					kind: m.kind,
				});
			}
		}
		return views;
	}
}
