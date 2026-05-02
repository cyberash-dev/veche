import { promises as fs } from "node:fs";
import path from "node:path";
import { ValidationError } from "../../../shared/errors/DomainError.js";
import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { IdGenPort } from "../../../shared/ports/IdGenPort.js";
import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import {
	asParticipantId,
	type MeetingId,
	PARTICIPANT_ID_PATTERN,
	type ParticipantId,
} from "../../../shared/types/ids.js";
import type { Instant } from "../../../shared/types/instant.js";
import type { ProfileResolver } from "../../agent-integration/application/ProfileResolver.js";
import {
	AdapterConfigInvalid,
	AdapterNotAvailable,
} from "../../agent-integration/domain/errors.js";
import type { AgentAdapterRegistryPort } from "../../agent-integration/ports/AgentAdapterRegistryPort.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import { encodeCursor } from "../domain/Cursor.js";
import { DuplicateParticipantId } from "../domain/errors.js";
import type { Meeting } from "../domain/Meeting.js";
import {
	type AdapterKind,
	DEFAULT_FACILITATOR_DISCUSSION_ROLE,
	DEFAULT_HUMAN_DISCUSSION_ROLE,
	DEFAULT_MODEL_DISCUSSION_ROLE,
	type DiscussionRole,
	type Participant,
	type ParticipantKind,
} from "../domain/Participant.js";
import {
	DefaultMaxRounds,
	MaxEnvEntries,
	MaxExtraFlags,
	MaxSystemPromptLengthBytes,
} from "./constants.js";

const FORBIDDEN_ENV_KEYS = new Set(["HOME", "PATH", "CODEX_BIN", "CLAUDE_BIN"]);
const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;

const resolvedDiscussionRole = (
	input: DiscussionRole | undefined | null,
	fallback: DiscussionRole,
	context: string,
): DiscussionRole => {
	if (input === undefined || input === null) {
		return fallback;
	}
	const name = input.name.trim();
	const description = input.description.trim();
	if (name.length === 0 || name.length > 64) {
		throw new ValidationError(`${context}: discussionRole.name must be 1..64 chars`);
	}
	if (description.length === 0 || description.length > 400) {
		throw new ValidationError(`${context}: discussionRole.description must be 1..400 chars`);
	}
	if (!Number.isFinite(input.weight) || input.weight <= 0) {
		throw new ValidationError(`${context}: discussionRole.weight must be > 0`);
	}
	return { name, description, weight: input.weight };
};

export interface StartMeetingCommand {
	readonly title: string;
	readonly facilitator?: {
		readonly id?: string;
		readonly displayName?: string;
		readonly discussionRole?: DiscussionRole;
	};
	readonly members: ReadonlyArray<{
		readonly id: string;
		readonly participantKind?: ParticipantKind;
		readonly discussionRole?: DiscussionRole;
		readonly profile?: string;
		readonly adapter?: AdapterKind;
		readonly model?: string;
		readonly systemPrompt?: string;
		readonly workdir?: string;
		readonly extraFlags?: readonly string[];
		readonly env?: Readonly<Record<string, string>>;
	}>;
	readonly defaultMaxRounds?: number;
}

export interface StartMeetingResult {
	readonly meetingId: MeetingId;
	readonly title: string;
	readonly createdAt: Instant;
	readonly participants: ReadonlyArray<{
		readonly id: ParticipantId;
		readonly role: "facilitator" | "member";
		readonly participantKind: ParticipantKind;
		readonly discussionRole: DiscussionRole;
		readonly adapter: AdapterKind | null;
		readonly profile: string | null;
		readonly model: string | null;
	}>;
	readonly defaultMaxRounds: number;
	readonly cursor: string;
}

export interface StartMeetingDeps {
	readonly store: MeetingStorePort;
	readonly clock: ClockPort;
	readonly ids: IdGenPort;
	readonly logger: LoggerPort;
	readonly adapters: AgentAdapterRegistryPort;
	readonly profileResolver: ProfileResolver;
	readonly maxRoundsCap: number;
}

export class StartMeetingUseCase {
	constructor(private readonly deps: StartMeetingDeps) {}

	async execute(command: StartMeetingCommand): Promise<StartMeetingResult> {
		const { store, clock, ids, logger, adapters, profileResolver, maxRoundsCap } = this.deps;

		const title = (command.title ?? "").trim();
		if (title.length === 0 || title.length > 200) {
			throw new ValidationError("title must be 1-200 chars after trim");
		}
		const maxRounds = command.defaultMaxRounds ?? DefaultMaxRounds;
		if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > maxRoundsCap) {
			throw new ValidationError(`defaultMaxRounds must be 1..${maxRoundsCap}`);
		}
		if (
			!Array.isArray(command.members) ||
			command.members.length === 0 ||
			command.members.length > 8
		) {
			throw new ValidationError("members must contain 1..8 entries");
		}

		const facilitatorId = (command.facilitator?.id ?? "facilitator").trim();
		if (!PARTICIPANT_ID_PATTERN.test(facilitatorId)) {
			throw new ValidationError(`facilitator id ${facilitatorId} is invalid`);
		}

		const seen = new Set<string>();
		seen.add(facilitatorId);

		const facilitator: Participant = {
			id: asParticipantId(facilitatorId),
			role: "facilitator",
			participantKind: "human",
			discussionRole: resolvedDiscussionRole(
				command.facilitator?.discussionRole,
				DEFAULT_FACILITATOR_DISCUSSION_ROLE,
				"facilitator",
			),
			isHumanParticipationEnabled: false,
			displayName: command.facilitator?.displayName ?? facilitatorId,
			adapter: null,
			profile: null,
			systemPrompt: null,
			workdir: null,
			model: null,
			extraFlags: [],
			env: {},
			sessionId: null,
			providerRef: null,
			status: "active",
			droppedAt: null,
			droppedReason: null,
		};

		const resolvedMembers: Participant[] = [];
		for (const entry of command.members) {
			if (!PARTICIPANT_ID_PATTERN.test(entry.id)) {
				throw new ValidationError(`member id ${entry.id} is invalid`);
			}
			if (seen.has(entry.id)) {
				throw new DuplicateParticipantId(entry.id);
			}
			seen.add(entry.id);
			const participantKind = entry.participantKind ?? "model";
			if (participantKind !== "model" && participantKind !== "human") {
				throw new ValidationError(`member ${entry.id}: participantKind is invalid`);
			}
			if (participantKind === "human") {
				if (
					entry.profile !== undefined ||
					entry.adapter !== undefined ||
					entry.model !== undefined ||
					entry.systemPrompt !== undefined ||
					entry.workdir !== undefined ||
					entry.extraFlags !== undefined ||
					entry.env !== undefined
				) {
					throw new ValidationError(
						`member ${entry.id}: human participants cannot define adapter configuration`,
					);
				}
				resolvedMembers.push({
					id: asParticipantId(entry.id),
					role: "member",
					participantKind: "human",
					discussionRole: resolvedDiscussionRole(
						entry.discussionRole,
						DEFAULT_HUMAN_DISCUSSION_ROLE,
						`member ${entry.id}`,
					),
					isHumanParticipationEnabled: true,
					displayName: entry.id,
					adapter: null,
					profile: null,
					systemPrompt: null,
					workdir: null,
					model: null,
					extraFlags: [],
					env: {},
					sessionId: null,
					providerRef: null,
					status: "active",
					droppedAt: null,
					droppedReason: null,
				});
				continue;
			}
			if (
				entry.systemPrompt &&
				Buffer.byteLength(entry.systemPrompt, "utf8") > MaxSystemPromptLengthBytes
			) {
				throw new ValidationError(`member ${entry.id}: systemPrompt exceeds 8 KiB`);
			}
			if (entry.extraFlags && entry.extraFlags.length > MaxExtraFlags) {
				throw new ValidationError(`member ${entry.id}: too many extraFlags`);
			}
			if (entry.env) {
				if (Object.keys(entry.env).length > MaxEnvEntries) {
					throw new ValidationError(`member ${entry.id}: too many env entries`);
				}
				for (const k of Object.keys(entry.env)) {
					if (!ENV_KEY.test(k) || FORBIDDEN_ENV_KEYS.has(k)) {
						throw new ValidationError(`member ${entry.id}: env key ${k} is forbidden`);
					}
				}
			}
			if (entry.workdir !== undefined) {
				if (!path.isAbsolute(entry.workdir)) {
					throw new ValidationError(`member ${entry.id}: workdir must be absolute`);
				}
				let stat: Awaited<ReturnType<typeof fs.stat>>;
				try {
					stat = await fs.stat(entry.workdir);
				} catch {
					throw new ValidationError(`member ${entry.id}: workdir does not exist`);
				}
				if (!stat.isDirectory()) {
					throw new ValidationError(`member ${entry.id}: workdir must be a directory`);
				}
			}

			const resolved = profileResolver.resolve({
				...(entry.profile !== undefined ? { profile: entry.profile } : {}),
				...(entry.adapter !== undefined ? { adapter: entry.adapter } : {}),
				...(entry.systemPrompt !== undefined ? { systemPrompt: entry.systemPrompt } : {}),
				...(entry.discussionRole !== undefined
					? { discussionRole: entry.discussionRole }
					: {}),
				...(entry.model !== undefined ? { model: entry.model } : {}),
				...(entry.workdir !== undefined ? { workdir: entry.workdir } : {}),
				...(entry.extraFlags !== undefined ? { extraFlags: entry.extraFlags } : {}),
				...(entry.env !== undefined ? { env: entry.env } : {}),
			});

			const caps = adapters.get(resolved.adapter).capabilities();
			if (resolved.workdir && !caps.supportsWorkdir) {
				throw new AdapterConfigInvalid(
					"AdapterConfigInvalid",
					`adapter ${resolved.adapter} does not support workdir`,
				);
			}
			if (resolved.systemPrompt && !caps.supportsSystemPrompt) {
				throw new AdapterConfigInvalid(
					"AdapterConfigInvalid",
					`adapter ${resolved.adapter} does not support systemPrompt`,
				);
			}

			resolvedMembers.push({
				id: asParticipantId(entry.id),
				role: "member",
				participantKind: "model",
				discussionRole: resolvedDiscussionRole(
					resolved.discussionRole,
					DEFAULT_MODEL_DISCUSSION_ROLE,
					`member ${entry.id}`,
				),
				isHumanParticipationEnabled: false,
				displayName: entry.id,
				adapter: resolved.adapter,
				profile: resolved.profile,
				systemPrompt: resolved.systemPrompt,
				workdir: resolved.workdir,
				model: resolved.model,
				extraFlags: resolved.extraFlags,
				env: resolved.env,
				sessionId: ids.newParticipantSessionId(),
				providerRef: null,
				status: "active",
				droppedAt: null,
				droppedReason: null,
			});
		}

		const meeting: Meeting = {
			id: ids.newMeetingId(),
			title,
			status: "active",
			createdAt: clock.now(),
			endedAt: null,
			participants: [facilitator, ...resolvedMembers],
			defaultMaxRounds: maxRounds,
		};

		const snap = await store.createMeeting({
			meeting,
			participants: [facilitator, ...resolvedMembers],
		});

		// Open a Session for each member. Roll back on failure.
		const openedSessions: Array<{
			participantId: ParticipantId;
			adapter: AdapterKind;
			session: import("../../agent-integration/domain/Session.js").Session;
		}> = [];
		try {
			for (const m of resolvedMembers) {
				if (m.participantKind === "human") {
					continue;
				}
				if (m.adapter === null || m.sessionId === null) {
					// Invariant — Model members carry adapter + sessionId after profile resolution.
					throw new ValidationError(`member ${m.id} missing adapter or sessionId`);
				}
				const adapter = adapters.get(m.adapter);
				const session = await adapter.openSession({
					meetingId: meeting.id,
					participantId: m.id,
					sessionId: m.sessionId,
					systemPrompt: m.systemPrompt,
					workdir: m.workdir,
					model: m.model,
					extraFlags: m.extraFlags,
					env: m.env,
				});
				openedSessions.push({ participantId: m.id, adapter: m.adapter, session });
			}
		} catch (err) {
			logger.warn("start_meeting.adapter.open.failed", {
				meetingId: meeting.id,
				error: (err as Error).message,
			});
			for (const o of openedSessions) {
				try {
					await adapters.get(o.adapter).closeSession(o.session);
				} catch {
					// best-effort
				}
			}
			await store.endMeeting({ meetingId: meeting.id, at: clock.now() });
			if (
				err instanceof AdapterConfigInvalid ||
				err instanceof AdapterNotAvailable ||
				err instanceof ValidationError
			) {
				throw err;
			}
			throw new AdapterNotAvailable("AdapterNotAvailable", (err as Error).message);
		}

		return {
			meetingId: meeting.id,
			title: meeting.title,
			createdAt: meeting.createdAt,
			participants: [facilitator, ...resolvedMembers].map((p) => ({
				id: p.id,
				role: p.role,
				participantKind: p.participantKind,
				discussionRole: p.discussionRole,
				adapter: p.adapter,
				profile: p.profile,
				model: p.model,
			})),
			defaultMaxRounds: meeting.defaultMaxRounds,
			cursor: encodeCursor({ seq: snap.lastSeq }),
		};
	}
}
