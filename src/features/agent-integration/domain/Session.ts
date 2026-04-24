import type { MeetingId, ParticipantId, SessionId } from "../../../shared/types/ids.js";
import type { Instant } from "../../../shared/types/instant.js";
import type { AdapterKind } from "../../meeting/domain/Participant.js";

export type SessionStatus = "open" | "closed";

export interface Session {
	readonly id: SessionId;
	readonly adapter: AdapterKind;
	readonly participantId: ParticipantId;
	readonly meetingId: MeetingId;
	readonly providerRef: string | null;
	readonly status: SessionStatus;
	readonly openedAt: Instant;
	readonly closedAt: Instant | null;
}
