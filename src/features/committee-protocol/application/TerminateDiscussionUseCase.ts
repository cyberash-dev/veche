import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { ParticipantId } from "../../../shared/types/ids.js";
import type { Job, JobError, TerminationReason } from "../../meeting/domain/Job.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import type { DiscussionState } from "../domain/DiscussionState.js";

export interface TerminateInput {
	readonly state: DiscussionState;
	readonly cancellationSignal: AbortSignal;
	readonly activeMembers: readonly ParticipantId[];
}

export interface TerminateDecision {
	readonly terminationReason: TerminationReason | null;
	readonly shouldFinalize: boolean;
}

export const decideTermination = (input: TerminateInput): TerminateDecision => {
	const { state, cancellationSignal, activeMembers } = input;
	if (cancellationSignal.aborted) {
		return { terminationReason: "cancelled", shouldFinalize: true };
	}
	if (activeMembers.length === 0) {
		return { terminationReason: "no-active-members", shouldFinalize: true };
	}
	if (state.roundNumber >= state.maxRounds) {
		return { terminationReason: "max-rounds", shouldFinalize: true };
	}
	const everyPassed = activeMembers.every((id) => state.pendingPass.has(id));
	if (everyPassed) {
		return { terminationReason: "all-passed", shouldFinalize: true };
	}
	return { terminationReason: null, shouldFinalize: false };
};

export interface FinalizeInput {
	readonly job: Job;
	readonly state: DiscussionState;
	readonly reason: TerminationReason;
	readonly cancelReason?: string;
	readonly error?: JobError;
}

export class TerminateDiscussionUseCase {
	constructor(
		private readonly deps: {
			readonly store: MeetingStorePort;
			readonly clock: ClockPort;
		},
	) {}

	decide(input: TerminateInput): TerminateDecision {
		return decideTermination(input);
	}

	async finalize(input: FinalizeInput): Promise<void> {
		const { store, clock } = this.deps;
		const now = clock.now();
		const roundsExecuted = input.state.roundNumber;
		if (input.reason === "cancelled") {
			await store.updateJob({
				jobId: input.job.id,
				patch: {
					status: "cancelled",
					finishedAt: now,
					cancelReason: input.cancelReason ?? "cancelled",
					lastSeq: input.state.lastSeq,
				},
			});
			await store.appendSystemEvent({
				meetingId: input.job.meetingId,
				type: "job.cancelled",
				payload: { jobId: input.job.id, cancelReason: input.cancelReason ?? "cancelled" },
				at: now,
			});
			return;
		}
		await store.updateJob({
			jobId: input.job.id,
			patch: {
				status: "completed",
				finishedAt: now,
				lastSeq: input.state.lastSeq,
				terminationReason: input.reason,
			},
		});
		await store.appendSystemEvent({
			meetingId: input.job.meetingId,
			type: "job.completed",
			payload: {
				jobId: input.job.id,
				terminationReason: input.reason,
				lastSeq: input.state.lastSeq,
				rounds: roundsExecuted,
			},
			at: now,
		});
	}

	async markFailed(input: { job: Job; state: DiscussionState; error: JobError }): Promise<void> {
		const { store, clock } = this.deps;
		const now = clock.now();
		await store.updateJob({
			jobId: input.job.id,
			patch: {
				status: "failed",
				finishedAt: now,
				lastSeq: input.state.lastSeq,
				error: input.error,
			},
		});
		await store.appendSystemEvent({
			meetingId: input.job.meetingId,
			type: "job.failed",
			payload: { jobId: input.job.id, error: input.error },
			at: now,
		});
	}
}
