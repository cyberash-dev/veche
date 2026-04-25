import { ValidationError } from "../../../shared/errors/DomainError.js";
import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { IdGenPort } from "../../../shared/ports/IdGenPort.js";
import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import {
	asParticipantId,
	type JobId,
	type MeetingId,
	type ParticipantId,
} from "../../../shared/types/ids.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import { encodeCursor } from "../domain/Cursor.js";
import {
	AddresseeNotFound,
	MeetingAlreadyEnded,
	MeetingBusy,
	MeetingNotFound,
	NoActiveMembers,
} from "../domain/errors.js";
import type { Job } from "../domain/Job.js";
import { DefaultTurnTimeoutMs, MaxTextLengthBytes } from "./constants.js";
import type { JobRunner } from "./JobRunner.js";

export interface SendMessageCommand {
	readonly meetingId: MeetingId;
	readonly text: string;
	readonly maxRounds?: number;
	readonly turnTimeoutMs?: number;
	readonly addressees?: readonly string[];
}

export interface SendMessageResult {
	readonly jobId: JobId;
	readonly meetingId: MeetingId;
	readonly cursor: string;
}

export interface SendMessageDeps {
	readonly store: MeetingStorePort;
	readonly clock: ClockPort;
	readonly ids: IdGenPort;
	readonly logger: LoggerPort;
	readonly jobRunner: JobRunner;
	readonly maxRoundsCap: number;
}

export class SendMessageUseCase {
	constructor(private readonly deps: SendMessageDeps) {}

	async execute(command: SendMessageCommand): Promise<SendMessageResult> {
		const { store, clock, ids, jobRunner, maxRoundsCap } = this.deps;
		const text = command.text?.trim() ?? "";
		if (text.length === 0) {
			throw new ValidationError("text must be non-empty after trim");
		}
		if (Buffer.byteLength(text, "utf8") > MaxTextLengthBytes) {
			throw new ValidationError("text exceeds 32 KiB");
		}
		const turnTimeoutMs = command.turnTimeoutMs ?? DefaultTurnTimeoutMs;
		if (
			!Number.isInteger(turnTimeoutMs) ||
			turnTimeoutMs < 10_000 ||
			turnTimeoutMs > 3_600_000
		) {
			throw new ValidationError("turnTimeoutMs must be 10_000..3_600_000");
		}

		const snap = await store.loadMeeting(command.meetingId);
		if (!snap) {
			throw new MeetingNotFound(command.meetingId);
		}
		if (snap.meeting.status === "ended") {
			throw new MeetingAlreadyEnded(command.meetingId);
		}

		const maxRounds = command.maxRounds ?? snap.meeting.defaultMaxRounds;
		if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > maxRoundsCap) {
			throw new ValidationError(`maxRounds must be 1..${maxRoundsCap}`);
		}

		const activeMembers = snap.participants.filter(
			(p) => p.role === "member" && p.status === "active",
		);
		if (activeMembers.length === 0) {
			throw new NoActiveMembers(command.meetingId);
		}

		let addresseeIds: readonly ParticipantId[] | null = null;
		if (command.addressees) {
			const set = new Set<string>();
			for (const a of command.addressees) {
				const match = snap.participants.find((p) => p.id === a);
				if (!match || match.role !== "member") {
					throw new AddresseeNotFound(command.meetingId, a);
				}
				set.add(match.id);
			}
			const filtered = activeMembers.filter((p) => set.has(p.id)).map((p) => p.id);
			if (filtered.length === 0) {
				throw new NoActiveMembers(command.meetingId);
			}
			addresseeIds = filtered;
		}

		const open = snap.openJobs[0];
		if (open !== undefined) {
			throw new MeetingBusy(command.meetingId, open.id);
		}

		const facilitator = snap.participants.find((p) => p.role === "facilitator");
		if (!facilitator) {
			throw new ValidationError("meeting has no facilitator");
		}

		const now = clock.now();
		const jobId = ids.newJobId();
		const job: Job = {
			id: jobId,
			meetingId: command.meetingId,
			status: "queued",
			createdAt: now,
			startedAt: null,
			finishedAt: null,
			maxRounds,
			turnTimeoutMs,
			addressees: addresseeIds,
			lastSeq: -1,
			rounds: 0,
			terminationReason: null,
			error: null,
			cancelReason: null,
		};
		try {
			await store.createJob(job);
		} catch (err) {
			if ((err as Error).name === "JobStateTransitionInvalid") {
				throw new MeetingBusy(command.meetingId, "unknown");
			}
			throw err;
		}

		const facilitatorMessage = await store.appendMessage({
			meetingId: command.meetingId,
			jobId: jobId,
			message: {
				id: ids.newMessageId(),
				round: 0,
				author: asParticipantId(facilitator.id),
				kind: "speech",
				text,
				createdAt: clock.now(),
			},
		});

		await store.appendSystemEvent({
			meetingId: command.meetingId,
			type: "job.started",
			payload: {
				jobId,
				maxRounds,
				turnTimeoutMs,
				addressees: addresseeIds,
			},
			at: clock.now(),
		});

		const runningJob = await store.updateJob({
			jobId,
			patch: { status: "running", startedAt: clock.now() },
		});

		jobRunner.start({ job: runningJob, facilitatorMessage });

		return {
			jobId,
			meetingId: command.meetingId,
			cursor: encodeCursor({ seq: facilitatorMessage.seq - 1 }),
		};
	}
}
