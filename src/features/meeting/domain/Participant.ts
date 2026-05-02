import type { ParticipantId, SessionId } from "../../../shared/types/ids.js";
import type { Instant } from "../../../shared/types/instant.js";

export type ParticipantRole = "facilitator" | "member";
export type ParticipantStatus = "active" | "dropped";
export type ParticipantKind = "model" | "human";
export type AdapterKind = "codex-cli" | "claude-code-cli";

export interface DiscussionRole {
	readonly name: string;
	readonly description: string;
	readonly weight: number;
}

export const DEFAULT_MODEL_DISCUSSION_ROLE: DiscussionRole = {
	name: "peer",
	description: "Independent committee member.",
	weight: 1,
};

export const DEFAULT_HUMAN_DISCUSSION_ROLE: DiscussionRole = {
	name: "observer/contributor",
	description:
		"Human participant providing steering and agreement feedback between model rounds.",
	weight: 1,
};

export const DEFAULT_FACILITATOR_DISCUSSION_ROLE: DiscussionRole = {
	name: "facilitator",
	description: "Host participant that frames the question and stores the final synthesis.",
	weight: 1,
};

export interface Participant {
	readonly id: ParticipantId;
	readonly role: ParticipantRole;
	readonly participantKind: ParticipantKind;
	readonly discussionRole: DiscussionRole;
	readonly isHumanParticipationEnabled: boolean;
	readonly displayName: string;
	readonly adapter: AdapterKind | null;
	readonly profile: string | null;
	readonly systemPrompt: string | null;
	readonly workdir: string | null;
	readonly model: string | null;
	readonly extraFlags: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly sessionId: SessionId | null;
	readonly providerRef: string | null;
	readonly status: ParticipantStatus;
	readonly droppedAt: Instant | null;
	readonly droppedReason: string | null;
}
