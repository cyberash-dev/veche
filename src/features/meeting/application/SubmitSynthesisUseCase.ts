import { ValidationError } from "../../../shared/errors/DomainError.js";
import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { JobId } from "../../../shared/types/ids.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import { JobAlreadyTerminal } from "../domain/errors.js";
import type { JobStatus } from "../domain/Job.js";
import { MaxTextLengthBytes } from "./constants.js";
import { synthesisForJob } from "./humanTurnState.js";

const TERMINAL: ReadonlySet<JobStatus> = new Set(["completed", "failed", "cancelled"]);

export interface SubmitSynthesisCommand {
	readonly jobId: JobId;
	readonly text: string;
}

export interface SubmitSynthesisResult {
	readonly jobId: JobId;
	readonly stored: true;
}

export class SubmitSynthesisUseCase {
	constructor(
		private readonly deps: {
			readonly store: MeetingStorePort;
			readonly clock: ClockPort;
		},
	) {}

	async execute(command: SubmitSynthesisCommand): Promise<SubmitSynthesisResult> {
		const { store, clock } = this.deps;
		const text = command.text.trim();
		if (text.length === 0) {
			throw new ValidationError("text must be non-empty after trim");
		}
		if (Buffer.byteLength(text, "utf8") > MaxTextLengthBytes) {
			throw new ValidationError("text exceeds 32 KiB");
		}
		await store.refresh?.();
		const { job, meetingId } = await store.loadJob(command.jobId);
		if (!TERMINAL.has(job.status)) {
			throw new ValidationError("synthesis can only be submitted for a terminal job");
		}
		if (!store.readAllEvents) {
			throw new ValidationError("store does not expose readAllEvents");
		}
		const events = await store.readAllEvents(meetingId);
		if (synthesisForJob(events, job.id) !== null) {
			throw new JobAlreadyTerminal(job.id, "synthesis-submitted");
		}
		await store.appendSystemEvent({
			meetingId,
			type: "synthesis.submitted",
			payload: { jobId: job.id, text },
			at: clock.now(),
		});
		return { jobId: job.id, stored: true };
	}
}
