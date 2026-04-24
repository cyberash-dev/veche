import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import type { JobId } from "../../../shared/types/ids.js";
import type { DiscussionRunner } from "../../committee-protocol/application/DiscussionRunner.js";
import type { Job } from "../domain/Job.js";
import type { Message } from "../domain/Message.js";
import { CancelAckTimeoutMs } from "./constants.js";

interface RunningJob {
	readonly controller: AbortController;
	readonly promise: Promise<void>;
}

export class JobRunner {
	private readonly running = new Map<JobId, RunningJob>();

	constructor(
		private readonly deps: {
			readonly runner: DiscussionRunner;
			readonly logger: LoggerPort;
		},
	) {}

	start(input: { job: Job; facilitatorMessage: Message }): void {
		if (this.running.has(input.job.id)) {
			return;
		}
		const controller = new AbortController();
		const promise = this.deps.runner
			.run({
				job: input.job,
				meetingId: input.job.meetingId,
				facilitatorMessage: input.facilitatorMessage,
				cancellationSignal: controller.signal,
			})
			.catch((err) => {
				this.deps.logger.error("job.runner.unhandled", {
					jobId: input.job.id,
					error: (err as Error).message,
				});
			})
			.finally(() => {
				this.running.delete(input.job.id);
			});
		this.running.set(input.job.id, { controller, promise });
	}

	isRunning(jobId: JobId): boolean {
		return this.running.has(jobId);
	}

	async cancel(jobId: JobId, reason: string): Promise<boolean> {
		const entry = this.running.get(jobId);
		if (!entry) {
			return false;
		}
		entry.controller.abort(new Error(reason));
		await Promise.race([
			entry.promise,
			new Promise<void>((resolve) => setTimeout(resolve, CancelAckTimeoutMs)),
		]);
		return true;
	}

	async shutdown(): Promise<void> {
		for (const [id, entry] of this.running) {
			entry.controller.abort(new Error("server shutdown"));
			try {
				await entry.promise;
			} catch (err) {
				this.deps.logger.warn("job.runner.shutdown.error", {
					jobId: id,
					error: (err as Error).message,
				});
			}
		}
		this.running.clear();
	}
}
