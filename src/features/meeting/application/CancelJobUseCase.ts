import { ValidationError } from "../../../shared/errors/DomainError.js";
import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { JobId } from "../../../shared/types/ids.js";
import type { Instant } from "../../../shared/types/instant.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import { JobAlreadyTerminal } from "../domain/errors.js";
import type { JobStatus } from "../domain/Job.js";
import type { JobRunner } from "./JobRunner.js";

export interface CancelJobCommand {
	readonly jobId: JobId;
	readonly reason?: string;
}

export interface CancelJobResult {
	readonly jobId: JobId;
	readonly status: "cancelled";
	readonly cancelledAt: Instant;
	readonly lastSeq: number;
}

const TERMINAL: ReadonlySet<JobStatus> = new Set(["completed", "failed", "cancelled"]);

export class CancelJobUseCase {
	constructor(
		private readonly deps: {
			readonly store: MeetingStorePort;
			readonly clock: ClockPort;
			readonly jobRunner: JobRunner;
		},
	) {}

	async execute(command: CancelJobCommand): Promise<CancelJobResult> {
		const { store, clock, jobRunner } = this.deps;
		const reason = (command.reason ?? "cancelled-by-user").trim();
		if (reason.length === 0 || reason.length > 200) {
			throw new ValidationError("reason must be 1..200 chars");
		}
		const { job } = await store.loadJob(command.jobId);
		if (TERMINAL.has(job.status)) {
			throw new JobAlreadyTerminal(job.id, job.status);
		}

		const wasRunning = await jobRunner.cancel(command.jobId, reason);
		// Re-read after graceful window.
		const refreshed = await store.loadJob(command.jobId);
		if (!TERMINAL.has(refreshed.job.status)) {
			const now = clock.now();
			await store.updateJob({
				jobId: command.jobId,
				patch: { status: "cancelled", finishedAt: now, cancelReason: reason },
			});
			await store.appendSystemEvent({
				meetingId: refreshed.meetingId,
				type: "job.cancelled",
				payload: { jobId: command.jobId, cancelReason: reason },
				at: now,
			});
		}
		const after = await store.loadJob(command.jobId);
		void wasRunning;
		return {
			jobId: command.jobId,
			status: "cancelled",
			cancelledAt: after.job.finishedAt ?? clock.now(),
			lastSeq: after.job.lastSeq,
		};
	}
}
