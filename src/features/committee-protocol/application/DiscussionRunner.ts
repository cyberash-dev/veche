import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { IdGenPort } from "../../../shared/ports/IdGenPort.js";
import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import type { MeetingId, ParticipantId } from "../../../shared/types/ids.js";
import type { Session } from "../../agent-integration/domain/Session.js";
import { InitialFetchPageSize } from "../../meeting/application/constants.js";
import type { Job } from "../../meeting/domain/Job.js";
import type { Message } from "../../meeting/domain/Message.js";
import type { Participant } from "../../meeting/domain/Participant.js";
import type { AnyEvent, HumanTurnSubmittedEvent } from "../../persistence/domain/Event.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import type { DiscussionState } from "../domain/DiscussionState.js";
import type { RunRoundUseCase } from "./RunRoundUseCase.js";
import type { TerminateDiscussionUseCase } from "./TerminateDiscussionUseCase.js";

export interface DiscussionRunnerDeps {
	readonly store: MeetingStorePort;
	readonly clock: ClockPort;
	readonly ids: IdGenPort;
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

		// `priorMessages` is the full transcript-so-far (including the facilitator's opening
		// Message). RunRoundUseCase narrows it per Member via `participantLastSeen` + drop-own
		// — see spec `spec/features/committee-protocol/run-round.usecase.md` step 4a.
		const priorMessages: Message[] = [input.facilitatorMessage];

		// Tracks the round in which each Participant most recently spoke. -1 means "has never
		// spoken". Mutated by RunRoundUseCase as it appends each Member's reply. Used to build
		// the per-Member transcript prefix (round-based delta) on the next Turn.
		const participantLastRound = new Map<ParticipantId, number>();
		for (const id of participants.keys()) {
			participantLastRound.set(id, -1);
		}

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
					priorMessages,
					participantLastRound,
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
			await this.pauseForHumanIfNeeded({
				job: input.job,
				state,
				participants,
				cancellationSignal: input.cancellationSignal,
			});

			// Refresh `priorMessages` with the full transcript for the next round.
			const delta = await store.readMessagesSince({
				meetingId: input.meetingId,
				limit: InitialFetchPageSize,
			});
			priorMessages.length = 0;
			priorMessages.push(...delta.messages);
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
			if (p.participantKind !== "model") {
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

	private async pauseForHumanIfNeeded(input: {
		readonly job: Job;
		readonly state: DiscussionState;
		readonly participants: Map<ParticipantId, Participant>;
		readonly cancellationSignal: AbortSignal;
	}): Promise<void> {
		const { store, clock, ids } = this.deps;
		await store.refresh?.();
		const fresh = await store.loadMeeting(input.state.meetingId);
		for (const participant of fresh.participants) {
			input.participants.set(participant.id, participant);
		}
		const human = fresh.participants
			.filter(
				(p) =>
					p.role === "member" &&
					p.participantKind === "human" &&
					p.status === "active" &&
					p.isHumanParticipationEnabled,
			)
			.sort((a, b) => a.id.localeCompare(b.id))[0];
		if (human === undefined) {
			return;
		}
		const agreeTargets = this.collectActive(input.participants, input.state);
		const requestId = ids.newUuid();
		await store.appendSystemEvent({
			meetingId: input.state.meetingId,
			type: "human.turn.requested",
			payload: {
				jobId: input.job.id,
				requestId,
				roundNumber: input.state.roundNumber,
				participantId: human.id,
				agreeTargets,
				strengths: [1, 2, 3],
			},
			at: clock.now(),
		});
		await store.updateJob({
			jobId: input.job.id,
			patch: { status: "waiting_for_human" },
		});

		const submission = await this.waitForHumanSubmission({
			job: input.job,
			state: input.state,
			human,
			requestId,
			cancellationSignal: input.cancellationSignal,
		});
		if (input.cancellationSignal.aborted) {
			return;
		}
		await store.updateJob({
			jobId: input.job.id,
			patch: { status: "running" },
		});
		if (submission !== null) {
			input.state.lastSeq = submission.payload.messageSeq;
			if (submission.payload.action === "steer") {
				input.state.pendingPass.clear();
			}
		}
	}

	private async waitForHumanSubmission(input: {
		readonly job: Job;
		readonly state: DiscussionState;
		readonly human: Participant;
		readonly requestId: string;
		readonly cancellationSignal: AbortSignal;
	}): Promise<HumanTurnSubmittedEvent | null> {
		while (!input.cancellationSignal.aborted) {
			await this.deps.store.refresh?.();
			const events = await this.events(input.state.meetingId);
			const submitted = this.submission(events, input.requestId);
			if (submitted !== null) {
				return submitted;
			}
			const snapshot = await this.deps.store.loadMeeting(input.state.meetingId);
			const human = snapshot.participants.find((p) => p.id === input.human.id);
			if (human !== undefined && !human.isHumanParticipationEnabled) {
				return this.autoSkip(input);
			}
			await sleep(250, input.cancellationSignal);
		}
		return null;
	}

	private async autoSkip(input: {
		readonly job: Job;
		readonly state: DiscussionState;
		readonly human: Participant;
		readonly requestId: string;
	}): Promise<HumanTurnSubmittedEvent> {
		const { store, clock, ids } = this.deps;
		const message = await store.appendMessage({
			meetingId: input.state.meetingId,
			jobId: input.job.id,
			message: {
				id: ids.newMessageId(),
				round: input.state.roundNumber,
				author: input.human.id,
				kind: "pass",
				text: "<PASS/>",
				createdAt: clock.now(),
			},
		});
		await store.appendSystemEvent({
			meetingId: input.state.meetingId,
			type: "human.turn.submitted",
			payload: {
				jobId: input.job.id,
				requestId: input.requestId,
				roundNumber: input.state.roundNumber,
				participantId: input.human.id,
				action: "skip",
				messageId: message.id,
				messageSeq: message.seq,
				auto: true,
			},
			at: clock.now(),
		});
		const events = await this.events(input.state.meetingId);
		const submitted = this.submission(events, input.requestId);
		if (submitted === null) {
			throw new Error(`human auto-skip event missing for ${input.requestId}`);
		}
		return submitted;
	}

	private async events(meetingId: MeetingId): Promise<readonly AnyEvent[]> {
		if (!this.deps.store.readAllEvents) {
			return [];
		}
		return this.deps.store.readAllEvents(meetingId);
	}

	private submission(
		events: readonly AnyEvent[],
		requestId: string,
	): HumanTurnSubmittedEvent | null {
		for (const event of events) {
			if (event.type === "human.turn.submitted" && event.payload.requestId === requestId) {
				return event;
			}
		}
		return null;
	}
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timer);
			resolve();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
