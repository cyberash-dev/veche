import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import type { JobId, MeetingId } from "../../../shared/types/ids.js";
import type { Instant } from "../../../shared/types/instant.js";
import type { AgentAdapterRegistryPort } from "../../agent-integration/ports/AgentAdapterRegistryPort.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import { MeetingBusy } from "../domain/errors.js";
import type { CancelJobUseCase } from "./CancelJobUseCase.js";

export interface EndMeetingCommand {
	readonly meetingId: MeetingId;
	readonly cancelRunningJob?: boolean;
}

export interface EndMeetingResult {
	readonly meetingId: MeetingId;
	readonly status: "ended";
	readonly endedAt: Instant;
	readonly cancelledJobId: JobId | null;
}

export class EndMeetingUseCase {
	constructor(
		private readonly deps: {
			readonly store: MeetingStorePort;
			readonly clock: ClockPort;
			readonly logger: LoggerPort;
			readonly adapters: AgentAdapterRegistryPort;
			readonly cancelJob: CancelJobUseCase;
		},
	) {}

	async execute(command: EndMeetingCommand): Promise<EndMeetingResult> {
		const { store, clock, logger, adapters, cancelJob } = this.deps;
		const snap = await store.loadMeeting(command.meetingId);
		let cancelledJobId: JobId | null = null;
		if (snap.openJobs.length > 0) {
			const openJob = snap.openJobs[0]!;
			if (!command.cancelRunningJob) {
				throw new MeetingBusy(command.meetingId, openJob.id);
			}
			await cancelJob.execute({ jobId: openJob.id, reason: "meeting-ended" });
			cancelledJobId = openJob.id;
		}

		for (const p of snap.participants) {
			if (p.role !== "member" || p.adapter === null || p.sessionId === null) {
				continue;
			}
			try {
				await adapters.get(p.adapter).closeSession({
					id: p.sessionId,
					adapter: p.adapter,
					participantId: p.id,
					meetingId: command.meetingId,
					providerRef: p.providerRef,
					status: "open",
					openedAt: snap.meeting.createdAt,
					closedAt: null,
				});
			} catch (err) {
				logger.warn("end_meeting.adapter.close.failed", {
					meetingId: command.meetingId,
					participantId: p.id,
					error: (err as Error).message,
				});
			}
		}

		const endedAt = clock.now();
		await store.endMeeting({ meetingId: command.meetingId, at: endedAt });
		return {
			meetingId: command.meetingId,
			status: "ended",
			endedAt,
			cancelledJobId,
		};
	}
}
