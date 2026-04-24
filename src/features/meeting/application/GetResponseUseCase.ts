import { ValidationError } from "../../../shared/errors/DomainError.js";
import type { JobId, MeetingId } from "../../../shared/types/ids.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import type { Job, JobError, JobStatus, TerminationReason } from "../domain/Job.js";
import type { Message } from "../domain/Message.js";
import { GetResponseDefaultLimit } from "./constants.js";

export interface GetResponseQuery {
	readonly jobId: JobId;
	readonly cursor?: string;
	readonly limit?: number;
	readonly waitMs?: number;
}

export interface GetResponseResult {
	readonly jobId: JobId;
	readonly meetingId: MeetingId;
	readonly status: JobStatus;
	readonly terminationReason: TerminationReason | null;
	readonly error: JobError | null;
	readonly messages: readonly Message[];
	readonly nextCursor: string;
	readonly hasMore: boolean;
}

export class GetResponseUseCase {
	constructor(private readonly deps: { readonly store: MeetingStorePort }) {}

	async execute(query: GetResponseQuery): Promise<GetResponseResult> {
		const { store } = this.deps;
		const limit = query.limit ?? GetResponseDefaultLimit;
		if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
			throw new ValidationError("limit must be 1..500");
		}
		const waitMs = query.waitMs ?? 0;
		if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 60_000) {
			throw new ValidationError("waitMs must be 0..60_000");
		}

		const { job, meetingId } = await store.loadJob(query.jobId);
		if (waitMs > 0 && (job.status === "queued" || job.status === "running")) {
			const preview = await store.readMessagesSince({
				meetingId,
				...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
				limit: 1,
			});
			if (preview.messages.length === 0 && !preview.hasMore) {
				await store.watchNewEvents({
					meetingId,
					...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
					timeoutMs: waitMs,
				});
			}
		}

		const page = await store.readMessagesSince({
			meetingId,
			...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
			limit,
		});
		const latestJob: Job = (await store.loadJob(query.jobId)).job;
		return {
			jobId: query.jobId,
			meetingId,
			status: latestJob.status,
			terminationReason: latestJob.terminationReason,
			error: latestJob.error,
			messages: page.messages,
			nextCursor: page.nextCursor,
			hasMore: page.hasMore,
		};
	}
}
