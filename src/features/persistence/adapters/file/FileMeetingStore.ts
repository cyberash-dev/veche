import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import type { ClockPort } from "../../../../shared/ports/ClockPort.js";
import type { LoggerPort } from "../../../../shared/ports/LoggerPort.js";
import type { JobId, MeetingId, ParticipantId } from "../../../../shared/types/ids.js";
import type { Instant } from "../../../../shared/types/instant.js";
import {
	CursorInvalid,
	JobAlreadyExists,
	JobNotFound,
	JobStateTransitionInvalid,
	MeetingAlreadyEnded,
	MeetingAlreadyExists,
	MeetingNotFound,
	ParticipantNotFound,
	StoreUnavailable,
} from "../../../meeting/domain/errors.js";
import type { Job, JobStatus } from "../../../meeting/domain/Job.js";
import type { Meeting } from "../../../meeting/domain/Meeting.js";
import type { DraftMessage, Message } from "../../../meeting/domain/Message.js";
import {
	DEFAULT_FACILITATOR_DISCUSSION_ROLE,
	DEFAULT_HUMAN_DISCUSSION_ROLE,
	DEFAULT_MODEL_DISCUSSION_ROLE,
	type Participant,
} from "../../../meeting/domain/Participant.js";
import type { AnyEvent, EventType } from "../../domain/Event.js";
import type {
	AppendSystemEventInput,
	JobPatch,
	ListMeetingsFilter,
	ListMeetingsResult,
	MeetingSnapshot,
	MeetingStorePort,
	MeetingSummary,
	MessagePage,
} from "../../ports/MeetingStorePort.js";

const TERMINAL_JOB_STATES: ReadonlySet<JobStatus> = new Set(["completed", "failed", "cancelled"]);
const OPEN_JOB_STATES: ReadonlySet<JobStatus> = new Set(["queued", "running", "waiting_for_human"]);

interface MeetingState {
	meeting: Meeting;
	participants: Map<ParticipantId, Participant>;
	jobs: Map<JobId, Job>;
	lastSeq: number;
	manifestWriteLock: Promise<void>;
	appendLock: Promise<void>;
	watchers: Set<Watcher>;
}

interface Watcher {
	sinceSeq: number;
	resolve: () => void;
	timer: ReturnType<typeof setTimeout>;
}

interface FileMeetingStoreOptions {
	readonly rootDir: string;
}

interface CursorPayload {
	readonly seq: number;
	readonly byteOffset?: number;
}

const decodeMessageCursor = (raw: string | undefined): CursorPayload => {
	if (raw === undefined) {
		return { seq: -1 };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
	} catch {
		throw new CursorInvalid("cannot decode cursor");
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new CursorInvalid("bad cursor");
	}
	const seq = (parsed as { seq?: unknown }).seq;
	if (typeof seq !== "number" || !Number.isInteger(seq) || seq < -1) {
		throw new CursorInvalid("bad seq");
	}
	const byteOffset = (parsed as { byteOffset?: unknown }).byteOffset;
	if (byteOffset !== undefined && (typeof byteOffset !== "number" || byteOffset < 0)) {
		throw new CursorInvalid("bad byteOffset");
	}
	return byteOffset === undefined ? { seq } : { seq, byteOffset };
};

const encodeMessageCursor = (seq: number, byteOffset: number): string =>
	Buffer.from(JSON.stringify({ seq, byteOffset }), "utf8").toString("base64url");

const isValidTransition = (from: JobStatus, to: JobStatus): boolean => {
	if (from === to) {
		return true;
	}
	switch (from) {
		case "queued":
			return to === "running" || to === "cancelled" || to === "failed";
		case "running":
			return (
				to === "waiting_for_human" ||
				to === "completed" ||
				to === "failed" ||
				to === "cancelled"
			);
		case "waiting_for_human":
			return to === "running" || to === "failed" || to === "cancelled";
		default:
			return false;
	}
};

/**
 * File-backed implementation of MeetingStorePort.
 * Event log under `<root>/meetings/<id>/events.jsonl`; manifest mirrors the aggregate.
 */
export class FileMeetingStore implements MeetingStorePort {
	private readonly root: string;
	private readonly states = new Map<MeetingId, MeetingState>();
	private readonly jobIndex = new Map<JobId, MeetingId>();
	private initialised = false;

	constructor(
		private readonly deps: {
			readonly clock: ClockPort;
			readonly logger: LoggerPort;
		},
		options: FileMeetingStoreOptions,
	) {
		this.root = options.rootDir;
	}

	async createMeeting(input: {
		meeting: Meeting;
		participants: readonly Participant[];
	}): Promise<MeetingSnapshot> {
		await this.ensureInit();
		if (this.states.has(input.meeting.id)) {
			throw new MeetingAlreadyExists(input.meeting.id);
		}
		await fs.mkdir(this.meetingDir(input.meeting.id), { recursive: true, mode: 0o700 });
		const state: MeetingState = {
			meeting: input.meeting,
			participants: new Map(),
			jobs: new Map(),
			lastSeq: -1,
			manifestWriteLock: Promise.resolve(),
			appendLock: Promise.resolve(),
			watchers: new Set(),
		};
		this.states.set(input.meeting.id, state);
		await this.append(state, {
			type: "meeting.created",
			payload: {
				title: input.meeting.title,
				defaultMaxRounds: input.meeting.defaultMaxRounds,
				createdAt: input.meeting.createdAt,
			},
		});
		for (const p of input.participants) {
			state.participants.set(p.id, p);
			await this.append(state, {
				type: "participant.joined",
				payload: {
					participant: {
						id: p.id,
						role: p.role,
						participantKind: p.participantKind,
						discussionRole: p.discussionRole,
						isHumanParticipationEnabled: p.isHumanParticipationEnabled,
						displayName: p.displayName,
						adapter: p.adapter,
						profile: p.profile,
						model: p.model,
						workdir: p.workdir,
						systemPrompt: p.systemPrompt,
						extraFlags: p.extraFlags,
						env: p.env,
						sessionId: p.sessionId,
					},
				},
			});
		}
		await this.writeManifest(state);
		return this.snapshot(state);
	}

	async loadMeeting(meetingId: MeetingId): Promise<MeetingSnapshot> {
		await this.ensureInit();
		const state = await this.mustState(meetingId);
		return this.snapshot(state);
	}

	async listMeetings(filter: ListMeetingsFilter): Promise<ListMeetingsResult> {
		await this.ensureInit();
		const summaries: MeetingSummary[] = [];
		for (const state of this.states.values()) {
			const m = state.meeting;
			if (filter.status && m.status !== filter.status) {
				continue;
			}
			if (filter.createdAfter && m.createdAt <= filter.createdAfter) {
				continue;
			}
			if (filter.createdBefore && m.createdAt >= filter.createdBefore) {
				continue;
			}
			const openJobCount = Array.from(state.jobs.values()).filter((j) =>
				OPEN_JOB_STATES.has(j.status),
			).length;
			summaries.push({
				meetingId: m.id,
				title: m.title,
				status: m.status,
				createdAt: m.createdAt,
				endedAt: m.endedAt,
				participants: Array.from(state.participants.values()).map((p) => ({
					id: p.id,
					role: p.role,
					participantKind: p.participantKind,
					discussionRole: p.discussionRole,
					isHumanParticipationEnabled: p.isHumanParticipationEnabled,
					adapter: p.adapter,
					status: p.status,
				})),
				lastSeq: state.lastSeq,
				openJobCount,
			});
		}
		summaries.sort((a, b) => {
			if (a.createdAt > b.createdAt) {
				return -1;
			}
			if (a.createdAt < b.createdAt) {
				return 1;
			}
			return a.meetingId.localeCompare(b.meetingId);
		});
		const startIndex = filter.cursor ? this.decodeListCursor(filter.cursor) : 0;
		const slice = summaries.slice(startIndex, startIndex + filter.limit);
		const nextIndex = startIndex + slice.length;
		const nextCursor = nextIndex < summaries.length ? this.encodeListCursor(nextIndex) : null;
		return { summaries: slice, nextCursor };
	}

	async endMeeting(input: { meetingId: MeetingId; at: Instant }): Promise<MeetingSnapshot> {
		await this.ensureInit();
		const state = await this.mustState(input.meetingId);
		if (state.meeting.status === "ended") {
			throw new MeetingAlreadyEnded(input.meetingId);
		}
		state.meeting = { ...state.meeting, status: "ended", endedAt: input.at };
		await this.append(state, { type: "meeting.ended", payload: {} });
		await this.writeManifest(state);
		return this.snapshot(state);
	}

	async createJob(job: Job): Promise<Job> {
		await this.ensureInit();
		const state = await this.mustState(job.meetingId);
		if (state.meeting.status === "ended") {
			throw new MeetingAlreadyEnded(job.meetingId);
		}
		if (state.jobs.has(job.id)) {
			throw new JobAlreadyExists(job.id);
		}
		const hasOpen = Array.from(state.jobs.values()).some((j) => OPEN_JOB_STATES.has(j.status));
		if (hasOpen) {
			throw new JobStateTransitionInvalid(job.id, "n/a", "queued");
		}
		state.jobs.set(job.id, job);
		this.jobIndex.set(job.id, job.meetingId);
		await this.writeJobIndex(job);
		await this.writeManifest(state);
		return job;
	}

	async loadJob(jobId: JobId): Promise<{ job: Job; meetingId: MeetingId }> {
		await this.ensureInit();
		const meetingId = this.jobIndex.get(jobId);
		if (!meetingId) {
			throw new JobNotFound(jobId);
		}
		const state = await this.mustState(meetingId);
		const job = state.jobs.get(jobId);
		if (!job) {
			throw new JobNotFound(jobId);
		}
		return { job, meetingId };
	}

	async updateJob(input: { jobId: JobId; patch: JobPatch }): Promise<Job> {
		const { job, meetingId } = await this.loadJob(input.jobId);
		const state = await this.mustState(meetingId);
		const patch = input.patch;
		if (patch.status && !isValidTransition(job.status, patch.status)) {
			throw new JobStateTransitionInvalid(job.id, job.status, patch.status);
		}
		if (TERMINAL_JOB_STATES.has(job.status) && patch.status && patch.status !== job.status) {
			throw new JobStateTransitionInvalid(job.id, job.status, patch.status);
		}
		const updated: Job = {
			...job,
			...(patch.status !== undefined ? { status: patch.status } : {}),
			...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
			...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
			...(patch.lastSeq !== undefined ? { lastSeq: patch.lastSeq } : {}),
			...(patch.rounds !== undefined ? { rounds: patch.rounds } : {}),
			...(patch.terminationReason !== undefined
				? { terminationReason: patch.terminationReason }
				: {}),
			...(patch.error !== undefined ? { error: patch.error } : {}),
			...(patch.cancelReason !== undefined ? { cancelReason: patch.cancelReason } : {}),
		};
		state.jobs.set(updated.id, updated);
		await this.writeManifest(state);
		return updated;
	}

	async appendMessage(input: {
		meetingId: MeetingId;
		jobId: JobId | null;
		message: DraftMessage;
	}): Promise<Message> {
		await this.ensureInit();
		const state = await this.mustState(input.meetingId);
		if (state.meeting.status === "ended") {
			throw new MeetingAlreadyEnded(input.meetingId);
		}
		const event = await this.append(state, {
			type: "message.posted",
			payload: {
				messageId: input.message.id,
				round: input.message.round,
				author: input.message.author,
				kind: input.message.kind,
				text: input.message.text,
				jobId: input.jobId,
			},
		});
		return {
			id: input.message.id,
			meetingId: input.meetingId,
			seq: event.seq,
			round: input.message.round,
			author: input.message.author,
			kind: input.message.kind,
			text: input.message.text,
			createdAt: input.message.createdAt,
		};
	}

	async appendSystemEvent(input: AppendSystemEventInput): Promise<{ seq: number }> {
		await this.ensureInit();
		const state = await this.mustState(input.meetingId);
		if (
			state.meeting.status === "ended" &&
			input.type !== "meeting.ended" &&
			input.type !== "synthesis.submitted"
		) {
			throw new MeetingAlreadyEnded(input.meetingId);
		}
		if (input.type === "human.participation.set") {
			const participantId = input.payload.participantId as ParticipantId;
			const participant = state.participants.get(participantId);
			if (!participant) {
				throw new ParticipantNotFound(input.meetingId, participantId);
			}
			state.participants.set(participantId, {
				...participant,
				isHumanParticipationEnabled: input.payload.enabled === true,
			});
		}
		const event = await this.append(state, { type: input.type, payload: input.payload });
		if (input.type === "human.participation.set") {
			await this.writeManifest(state);
		}
		return { seq: event.seq };
	}

	async readMessagesSince(input: {
		meetingId: MeetingId;
		cursor?: string;
		limit: number;
	}): Promise<MessagePage> {
		await this.ensureInit();
		const state = await this.mustState(input.meetingId);
		const cur = decodeMessageCursor(input.cursor);
		const events = await this.readAllEventsInternal(state.meeting.id);
		const messages: Message[] = [];
		let lastScannedSeq = cur.seq;
		for (const ev of events) {
			if (ev.seq <= cur.seq) {
				continue;
			}
			lastScannedSeq = ev.seq;
			if (ev.type === "message.posted") {
				messages.push({
					id: ev.payload.messageId,
					meetingId: state.meeting.id,
					seq: ev.seq,
					round: ev.payload.round,
					author: ev.payload.author as Message["author"],
					kind: ev.payload.kind,
					text: ev.payload.text,
					createdAt: ev.at,
				});
				if (messages.length >= input.limit) {
					break;
				}
			}
		}
		const hasMore = lastScannedSeq < state.lastSeq;
		const nextCursor = encodeMessageCursor(lastScannedSeq, 0);
		return { messages, nextCursor, hasMore };
	}

	async markParticipantDropped(input: {
		meetingId: MeetingId;
		participantId: ParticipantId;
		reason: string;
		error: Job["error"];
		jobId: JobId | null;
		at: Instant;
	}): Promise<void> {
		await this.ensureInit();
		const state = await this.mustState(input.meetingId);
		const participant = state.participants.get(input.participantId);
		if (!participant) {
			throw new ParticipantNotFound(input.meetingId, input.participantId);
		}
		state.participants.set(input.participantId, {
			...participant,
			status: "dropped",
			droppedAt: input.at,
			droppedReason: input.reason,
		});
		await this.append(state, {
			type: "participant.dropped",
			payload: {
				participantId: input.participantId,
				reason: input.reason,
				error: input.error,
				jobId: input.jobId,
			},
		});
		await this.writeManifest(state);
	}

	async watchNewEvents(input: {
		meetingId: MeetingId;
		cursor?: string;
		timeoutMs: number;
	}): Promise<void> {
		await this.ensureInit();
		const state = await this.mustState(input.meetingId);
		const cur = decodeMessageCursor(input.cursor);
		if (state.lastSeq > cur.seq) {
			return;
		}
		await new Promise<void>((resolve) => {
			const watcher: Watcher = {
				sinceSeq: cur.seq,
				resolve,
				timer: setTimeout(
					() => {
						state.watchers.delete(watcher);
						resolve();
					},
					Math.max(0, input.timeoutMs),
				),
			};
			state.watchers.add(watcher);
		});
	}

	async readAllEvents(meetingId: MeetingId): Promise<readonly AnyEvent[]> {
		await this.ensureInit();
		return this.readAllEventsInternal(meetingId);
	}

	async refresh(): Promise<void> {
		await this.ensureInit();
		try {
			const entries = await fs.readdir(path.join(this.root, "meetings"));
			for (const entry of entries) {
				const dir = path.join(this.root, "meetings", entry);
				try {
					const stat = await fs.stat(dir);
					if (!stat.isDirectory()) {
						continue;
					}
				} catch {
					continue;
				}
				await this.refreshMeetingFromDisk(entry as MeetingId);
			}
			const jobFiles = await fs.readdir(path.join(this.root, "jobs"));
			for (const f of jobFiles) {
				if (!f.endsWith(".json")) {
					continue;
				}
				const jobId = f.slice(0, -".json".length) as JobId;
				if (this.jobIndex.has(jobId)) {
					continue;
				}
				const raw = await fs.readFile(path.join(this.root, "jobs", f), "utf8");
				try {
					const parsed = JSON.parse(raw) as { meetingId: MeetingId; jobId: JobId };
					this.jobIndex.set(parsed.jobId, parsed.meetingId);
				} catch {
					this.deps.logger.warn("filestore.job-index.corrupt", { file: f });
				}
			}
		} catch (err) {
			throw new StoreUnavailable(`cannot refresh store: ${(err as Error).message}`);
		}
	}

	// ---------- filesystem helpers ----------

	private async ensureInit(): Promise<void> {
		if (this.initialised) {
			return;
		}
		this.initialised = true;
		await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
		await fs.mkdir(path.join(this.root, "meetings"), { recursive: true, mode: 0o700 });
		await fs.mkdir(path.join(this.root, "jobs"), { recursive: true, mode: 0o700 });
		try {
			const entries = await fs.readdir(path.join(this.root, "meetings"));
			for (const entry of entries) {
				const dir = path.join(this.root, "meetings", entry);
				try {
					const stat = await fs.stat(dir);
					if (!stat.isDirectory()) {
						continue;
					}
				} catch {
					continue;
				}
				await this.loadMeetingFromDisk(entry as MeetingId);
			}
			const jobFiles = await fs.readdir(path.join(this.root, "jobs"));
			for (const f of jobFiles) {
				if (!f.endsWith(".json")) {
					continue;
				}
				const raw = await fs.readFile(path.join(this.root, "jobs", f), "utf8");
				try {
					const { meetingId, jobId } = JSON.parse(raw) as {
						meetingId: MeetingId;
						jobId: JobId;
					};
					this.jobIndex.set(jobId, meetingId);
				} catch {
					this.deps.logger.warn("filestore.job-index.corrupt", { file: f });
				}
			}
		} catch (err) {
			throw new StoreUnavailable(`cannot initialise store: ${(err as Error).message}`);
		}
	}

	private async loadMeetingFromDisk(meetingId: MeetingId): Promise<void> {
		const dir = this.meetingDir(meetingId);
		const eventsPath = path.join(dir, "events.jsonl");
		let raw = "";
		try {
			await fs.access(eventsPath, fsConstants.R_OK);
			raw = await fs.readFile(eventsPath, "utf8");
		} catch {
			return;
		}
		const lines = raw.split("\n").filter((l) => l.length > 0);
		const events: AnyEvent[] = [];
		for (const line of lines) {
			try {
				events.push(JSON.parse(line) as AnyEvent);
			} catch {
				throw new StoreUnavailable(`corrupt event line in ${eventsPath}`);
			}
		}
		const state = this.reduce(meetingId, events);
		this.states.set(meetingId, state);
	}

	private async refreshMeetingFromDisk(meetingId: MeetingId): Promise<void> {
		const existing = this.states.get(meetingId);
		if (existing === undefined) {
			await this.loadMeetingFromDisk(meetingId);
			return;
		}
		const eventsPath = path.join(this.meetingDir(meetingId), "events.jsonl");
		let raw = "";
		try {
			await fs.access(eventsPath, fsConstants.R_OK);
			raw = await fs.readFile(eventsPath, "utf8");
		} catch {
			return;
		}
		const lines = raw.split("\n").filter((l) => l.length > 0);
		const events: AnyEvent[] = [];
		for (const line of lines) {
			try {
				events.push(JSON.parse(line) as AnyEvent);
			} catch {
				throw new StoreUnavailable(`corrupt event line in ${eventsPath}`);
			}
		}
		if (events.length === 0) {
			return;
		}
		const maxSeq = events.reduce((acc, ev) => (ev.seq > acc ? ev.seq : acc), -1);
		if (maxSeq <= existing.lastSeq) {
			return;
		}
		const fresh = this.reduce(meetingId, events);
		// Preserve append-lock chain, manifest-write lock, and in-process watchers — they are
		// owned by the writer process. We only refresh the value-object slots.
		existing.meeting = fresh.meeting;
		existing.participants = fresh.participants;
		existing.jobs = fresh.jobs;
		existing.lastSeq = fresh.lastSeq;
	}

	private reduce(meetingId: MeetingId, events: readonly AnyEvent[]): MeetingState {
		let meeting: Meeting | null = null;
		const participants = new Map<ParticipantId, Participant>();
		const jobs = new Map<JobId, Job>();
		let lastSeq = -1;
		for (const ev of events) {
			lastSeq = Math.max(lastSeq, ev.seq);
			if (ev.type === "meeting.created") {
				meeting = {
					id: meetingId,
					title: ev.payload.title,
					status: "active",
					createdAt: ev.payload.createdAt,
					endedAt: null,
					participants: [],
					defaultMaxRounds: ev.payload.defaultMaxRounds,
				};
			} else if (ev.type === "participant.joined") {
				const p = ev.payload.participant;
				const participantKind =
					p.participantKind ??
					(p.role === "facilitator" || p.adapter === null ? "human" : "model");
				const defaultRole =
					p.role === "facilitator"
						? DEFAULT_FACILITATOR_DISCUSSION_ROLE
						: participantKind === "human"
							? DEFAULT_HUMAN_DISCUSSION_ROLE
							: DEFAULT_MODEL_DISCUSSION_ROLE;
				participants.set(p.id, {
					id: p.id,
					role: p.role,
					participantKind,
					discussionRole: p.discussionRole ?? defaultRole,
					isHumanParticipationEnabled:
						p.isHumanParticipationEnabled ?? participantKind === "human",
					displayName: p.displayName,
					adapter: p.adapter,
					profile: p.profile,
					systemPrompt: p.systemPrompt,
					workdir: p.workdir,
					model: p.model,
					extraFlags: p.extraFlags,
					env: p.env,
					sessionId: (p.sessionId as Participant["sessionId"]) ?? null,
					providerRef: null,
					status: "active",
					droppedAt: null,
					droppedReason: null,
				});
			} else if (ev.type === "participant.dropped") {
				const existing = participants.get(ev.payload.participantId);
				if (existing) {
					participants.set(existing.id, {
						...existing,
						status: "dropped",
						droppedAt: ev.at,
						droppedReason: ev.payload.reason,
					});
				}
			} else if (ev.type === "job.started") {
				jobs.set(ev.payload.jobId, {
					id: ev.payload.jobId,
					meetingId,
					status: "running",
					createdAt: ev.at,
					startedAt: ev.at,
					finishedAt: null,
					maxRounds: ev.payload.maxRounds,
					turnTimeoutMs: ev.payload.turnTimeoutMs,
					addressees: ev.payload.addressees,
					lastSeq: -1,
					rounds: 0,
					terminationReason: null,
					error: null,
					cancelReason: null,
				});
			} else if (ev.type === "round.completed") {
				const j = jobs.get(ev.payload.jobId);
				if (j) {
					jobs.set(j.id, { ...j, rounds: ev.payload.roundNumber });
				}
			} else if (ev.type === "human.participation.set") {
				const existing = participants.get(ev.payload.participantId);
				if (existing) {
					participants.set(existing.id, {
						...existing,
						isHumanParticipationEnabled: ev.payload.enabled,
					});
				}
			} else if (ev.type === "human.turn.requested") {
				const j = jobs.get(ev.payload.jobId);
				if (j) {
					jobs.set(j.id, { ...j, status: "waiting_for_human" });
				}
			} else if (ev.type === "human.turn.submitted") {
				const j = jobs.get(ev.payload.jobId);
				if (j) {
					jobs.set(j.id, { ...j, status: "running", lastSeq: ev.payload.messageSeq });
				}
			} else if (ev.type === "job.completed") {
				const j = jobs.get(ev.payload.jobId);
				if (j) {
					jobs.set(j.id, {
						...j,
						status: "completed",
						finishedAt: ev.at,
						lastSeq: ev.payload.lastSeq,
						rounds: ev.payload.rounds,
						terminationReason: ev.payload.terminationReason,
					});
				}
			} else if (ev.type === "job.failed") {
				const j = jobs.get(ev.payload.jobId);
				if (j) {
					jobs.set(j.id, {
						...j,
						status: "failed",
						finishedAt: ev.at,
						error: ev.payload.error,
					});
				}
			} else if (ev.type === "job.cancelled") {
				const j = jobs.get(ev.payload.jobId);
				if (j) {
					jobs.set(j.id, {
						...j,
						status: "cancelled",
						finishedAt: ev.at,
						cancelReason: ev.payload.cancelReason,
					});
				}
			} else if (ev.type === "meeting.ended") {
				if (meeting !== null) {
					const updated: Meeting = {
						id: meeting.id,
						title: meeting.title,
						status: "ended",
						createdAt: meeting.createdAt,
						endedAt: ev.at,
						participants: meeting.participants,
						defaultMaxRounds: meeting.defaultMaxRounds,
					};
					meeting = updated;
				}
			}
		}
		if (!meeting) {
			throw new StoreUnavailable(`corrupt log for meeting ${meetingId}`);
		}
		return {
			meeting,
			participants,
			jobs,
			lastSeq,
			manifestWriteLock: Promise.resolve(),
			appendLock: Promise.resolve(),
			watchers: new Set(),
		};
	}

	private async append(
		state: MeetingState,
		input: { type: EventType; payload: unknown },
	): Promise<AnyEvent> {
		// Serialise appends per meeting via a chained lock.
		let release!: () => void;
		const prev = state.appendLock;
		state.appendLock = new Promise<void>((resolve) => {
			release = resolve;
		});
		await prev;
		try {
			const seq = state.lastSeq + 1;
			const event = {
				meetingId: state.meeting.id,
				seq,
				type: input.type,
				at: this.deps.clock.now(),
				payload: input.payload,
			} as unknown as AnyEvent;
			const line = `${JSON.stringify(event)}\n`;
			const handle = await fs.open(
				path.join(this.meetingDir(state.meeting.id), "events.jsonl"),
				"a",
			);
			try {
				await handle.write(line);
				await handle.sync();
			} finally {
				await handle.close();
			}
			state.lastSeq = seq;
			// Wake watchers whose sinceSeq < seq.
			for (const w of Array.from(state.watchers)) {
				if (w.sinceSeq < seq) {
					clearTimeout(w.timer);
					state.watchers.delete(w);
					w.resolve();
				}
			}
			return event;
		} finally {
			release();
		}
	}

	private async readAllEventsInternal(meetingId: MeetingId): Promise<readonly AnyEvent[]> {
		const raw = await fs.readFile(
			path.join(this.meetingDir(meetingId), "events.jsonl"),
			"utf8",
		);
		const out: AnyEvent[] = [];
		for (const line of raw.split("\n")) {
			if (line.length === 0) {
				continue;
			}
			try {
				out.push(JSON.parse(line) as AnyEvent);
			} catch {
				throw new StoreUnavailable(`corrupt line in events.jsonl for ${meetingId}`);
			}
		}
		return out;
	}

	private async writeManifest(state: MeetingState): Promise<void> {
		const prev = state.manifestWriteLock;
		let release!: () => void;
		state.manifestWriteLock = new Promise<void>((resolve) => {
			release = resolve;
		});
		await prev;
		try {
			const manifest = {
				meeting: state.meeting,
				participants: Array.from(state.participants.values()),
				jobs: Array.from(state.jobs.values()),
				lastSeq: state.lastSeq,
			};
			const tmp = path.join(this.meetingDir(state.meeting.id), "manifest.json.tmp");
			const final = path.join(this.meetingDir(state.meeting.id), "manifest.json");
			await fs.writeFile(tmp, JSON.stringify(manifest), { mode: 0o600 });
			await fs.rename(tmp, final);
		} finally {
			release();
		}
	}

	private async writeJobIndex(job: Job): Promise<void> {
		const indexDir = path.join(this.root, "jobs");
		const tmp = path.join(indexDir, `${job.id}.json.tmp`);
		const final = path.join(indexDir, `${job.id}.json`);
		await fs.writeFile(tmp, JSON.stringify({ meetingId: job.meetingId, jobId: job.id }), {
			mode: 0o600,
		});
		await fs.rename(tmp, final);
	}

	private meetingDir(meetingId: MeetingId): string {
		return path.join(this.root, "meetings", meetingId);
	}

	private async mustState(meetingId: MeetingId): Promise<MeetingState> {
		const state = this.states.get(meetingId);
		if (!state) {
			throw new MeetingNotFound(meetingId);
		}
		return state;
	}

	private snapshot(state: MeetingState): MeetingSnapshot {
		return {
			meeting: state.meeting,
			participants: Array.from(state.participants.values()),
			openJobs: Array.from(state.jobs.values()).filter((j) => OPEN_JOB_STATES.has(j.status)),
			lastSeq: state.lastSeq,
		};
	}

	private encodeListCursor(i: number): string {
		return Buffer.from(`list:${i}`, "utf8").toString("base64url");
	}

	private decodeListCursor(raw: string): number {
		try {
			const decoded = Buffer.from(raw, "base64url").toString("utf8");
			if (!decoded.startsWith("list:")) {
				throw new Error("bad prefix");
			}
			const n = Number.parseInt(decoded.slice(5), 10);
			if (!Number.isFinite(n) || n < 0) {
				throw new Error("bad index");
			}
			return n;
		} catch {
			throw new CursorInvalid("cannot decode list cursor");
		}
	}
}
