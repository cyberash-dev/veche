import type { ParticipantId, SessionId } from "../../../shared/types/ids.js";
import type { Instant } from "../../../shared/types/instant.js";

export type ParticipantRole = "facilitator" | "member";
export type ParticipantStatus = "active" | "dropped";
export type AdapterKind = "codex-cli" | "claude-code-cli";

export interface Participant {
	readonly id: ParticipantId;
	readonly role: ParticipantRole;
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
