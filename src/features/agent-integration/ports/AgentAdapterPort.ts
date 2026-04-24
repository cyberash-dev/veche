import type { MeetingId, ParticipantId, SessionId } from "../../../shared/types/ids.js";
import type { AdapterKind } from "../../meeting/domain/Participant.js";
import type { Session } from "../domain/Session.js";
import type { Turn, TurnResult } from "../domain/Turn.js";

export interface AdapterCapabilities {
	readonly adapter: AdapterKind;
	readonly supportsWorkdir: boolean;
	readonly supportsSystemPrompt: boolean;
}

export interface OpenSessionInput {
	readonly meetingId: MeetingId;
	readonly participantId: ParticipantId;
	readonly sessionId: SessionId;
	readonly systemPrompt: string | null;
	readonly workdir: string | null;
	readonly model: string | null;
	readonly extraFlags: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

export interface AgentAdapterPort {
	capabilities(): AdapterCapabilities;
	openSession(input: OpenSessionInput): Promise<Session>;
	sendTurn(turn: Turn): Promise<TurnResult>;
	closeSession(session: Session): Promise<Session>;
}
