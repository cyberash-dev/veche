import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import type { MeetingId, ParticipantId } from "../../../shared/types/ids.js";
import type { Session } from "../../agent-integration/domain/Session.js";
import { InitialFetchPageSize } from "../../meeting/application/constants.js";
import type { Job } from "../../meeting/domain/Job.js";
import type { Message } from "../../meeting/domain/Message.js";
import type { Participant } from "../../meeting/domain/Participant.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import type { DiscussionState } from "../domain/DiscussionState.js";
import type { RunRoundUseCase } from "./RunRoundUseCase.js";
import type { TerminateDiscussionUseCase } from "./TerminateDiscussionUseCase.js";

export interface DiscussionRunnerDeps {
	readonly store: MeetingStorePort;
	readonly clock: ClockPort;
	readonly logger: LoggerPort;
	readonly runRound: RunRoundUseCase;
	readonly terminate: TerminateDiscussionUseCase;
}

export interface RunDiscussionInput {
	readonly job: Job;
	readonly meetingId: MeetingId;
	readonly facilitatorMessage: Message;
	readonly cancellationSignal: AbortSignal;
}

export class DiscussionRunner {
	constructor(private readonly deps: DiscussionRunnerDeps) {}

	async run(input: RunDiscussionInput): Promise<void> {
		const { store, logger, runRound, terminate } = this.deps;
		const snap = await store.loadMeeting(input.meetingId);
		const participants = new Map<ParticipantId, Participant>();
		for (const p of snap.participants) {
			participants.set(p.id, p);
		}

		const sessions = new Map<ParticipantId, Session>();
		for (const p of snap.participants) {
			if (p.role !== "member" || p.adapter === null || p.sessionId === null) {
				continue;
			}
			sessions.set(p.id, {
				id: p.sessionId,
				adapter: p.adapter,
				participantId: p.id,
				meetingId: input.meetingId,
				providerRef: p.providerRef,
				status: "active" === p.status ? "open" : "closed",
				openedAt: snap.meeting.createdAt,
				closedAt: null,
			});
		}

		const state: DiscussionState = {
			jobId: input.job.id,
			meetingId: input.meetingId,
			maxRounds: input.job.maxRounds,
			roundNumber: 0,
			pendingPass: new Set(),
			droppedThisJob: new Set(),
			terminationReason: null,
			lastSeq: input.facilitatorMessage.seq,
		};

		const participantLastSeen = new Map<ParticipantId, number>();
		for (const id of participants.keys()) {
			participantLastSeen.set(id, -1);
		}

		// Seed prior messages (none yet — the only message visible at round start is the facilitator message,
		// which is passed separately).
		const priorMessages: Message[] = [];

		while (!state.terminationReason) {
			const activeMembers = this.collectActive(participants, state);
			const decision = terminate.decide({
				state,
				cancellationSignal: input.cancellationSignal,
				activeMembers,
			});
			if (decision.shouldFinalize) {
				state.terminationReason = decision.terminationReason;
				break;
			}

			try {
				await runRound.execute({
					job: input.job,
					state,
					participants,
					sessions,
					facilitatorMessage: input.facilitatorMessage,
					priorMessages,
					participantLastSeen,
					cancellationSignal: input.cancellationSignal,
				});
			} catch (err) {
				logger.error("discussion.round.failed", {
					jobId: input.job.id,
					error: (err as Error).message,
				});
				await terminate.markFailed({
					job: input.job,
					state,
					error: {
						code: "DiscussionRunnerError",
						message: (err as Error).message,
					},
				});
				return;
			}
			// Pull newly-appended messages for the next round's priorMessages.
			const delta = await store.readMessagesSince({
				meetingId: input.meetingId,
				limit: InitialFetchPageSize,
			});
			priorMessages.length = 0;
			for (const m of delta.messages) {
				if (m.seq === input.facilitatorMessage.seq) {
					continue;
				}
				priorMessages.push(m);
			}
		}

		if (!state.terminationReason) {
			return;
		}
		try {
			if (state.terminationReason === "cancelled") {
				await terminate.finalize({
					job: input.job,
					state,
					reason: "cancelled",
					cancelReason:
						input.cancellationSignal.reason instanceof Error
							? input.cancellationSignal.reason.message
							: "cancelled",
				});
			} else {
				await terminate.finalize({
					job: input.job,
					state,
					reason: state.terminationReason,
				});
			}
		} catch (err) {
			logger.error("discussion.finalize.failed", {
				jobId: input.job.id,
				error: (err as Error).message,
			});
		}
	}

	private collectActive(
		participants: ReadonlyMap<ParticipantId, Participant>,
		state: DiscussionState,
	): ParticipantId[] {
		const out: ParticipantId[] = [];
		for (const p of participants.values()) {
			if (p.role !== "member") {
				continue;
			}
			if (p.status === "dropped") {
				continue;
			}
			if (state.droppedThisJob.has(p.id)) {
				continue;
			}
			out.push(p.id);
		}
		return out;
	}
}
