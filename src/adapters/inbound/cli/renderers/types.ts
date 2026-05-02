import type { SynthesisView } from "../../../../features/meeting/application/humanTurnState.js";
import type { Job } from "../../../../features/meeting/domain/Job.js";
import type { Meeting } from "../../../../features/meeting/domain/Meeting.js";
import type { Message } from "../../../../features/meeting/domain/Message.js";
import type { Participant } from "../../../../features/meeting/domain/Participant.js";
import type { AnyEvent } from "../../../../features/persistence/domain/Event.js";
import type { Instant } from "../../../../shared/types/instant.js";

export interface RenderInput {
	readonly meeting: Meeting;
	readonly participants: readonly Participant[];
	readonly jobs: readonly Job[];
	readonly messages: readonly Message[];
	readonly synthesis: SynthesisView | null;
	/** Non-null when `--raw` is set; populated from `MeetingStorePort.readAllEvents`. */
	readonly events: readonly AnyEvent[] | null;
	readonly generatedAt: Instant;
	readonly useColor: boolean;
	readonly version: string;
}

export type Renderer = (input: RenderInput) => string;
