import type { ParticipantId } from "../../../shared/types/ids.js";
import type { ParticipantRole } from "../../meeting/domain/Participant.js";
import type { Session } from "./Session.js";

export interface MessageView {
	readonly authorId: string;
	readonly authorRole: ParticipantRole | "system";
	readonly round: number;
	readonly text: string;
	readonly kind?: "speech" | "pass" | "system";
}

export interface Turn {
	readonly session: Session;
	readonly participantId: ParticipantId;
	readonly prompt: string;
	readonly transcriptPrefix: readonly MessageView[];
	readonly systemPrompt: string | null;
	readonly workdir: string | null;
	readonly model: string | null;
	readonly extraFlags: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly roundNumber: number;
	readonly timeoutMs: number;
	readonly cancellationSignal: AbortSignal;
}

export interface TurnError {
	readonly code: string;
	readonly message: string;
	readonly retryable: boolean;
}

export type TurnResult =
	| {
			readonly kind: "speech";
			readonly text: string;
			readonly providerRef: string | null;
			readonly durationMs: number;
			readonly error: null;
	  }
	| {
			readonly kind: "pass";
			readonly text: "<PASS/>";
			readonly providerRef: string | null;
			readonly durationMs: number;
			readonly error: null;
	  }
	| {
			readonly kind: "failure";
			readonly text: null;
			readonly providerRef: string | null;
			readonly durationMs: number;
			readonly error: TurnError;
	  };
