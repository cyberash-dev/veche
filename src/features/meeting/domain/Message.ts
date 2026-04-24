import type { MeetingId, MessageId, ParticipantId } from "../../../shared/types/ids.js";
import type { Instant } from "../../../shared/types/instant.js";

export type MessageKind = "speech" | "pass" | "system";

export type MessageAuthor = ParticipantId | "system";

export interface Message {
	readonly id: MessageId;
	readonly meetingId: MeetingId;
	readonly seq: number;
	readonly round: number;
	readonly author: MessageAuthor;
	readonly kind: MessageKind;
	readonly text: string;
	readonly createdAt: Instant;
}

export interface DraftMessage {
	readonly id: MessageId;
	readonly round: number;
	readonly author: MessageAuthor;
	readonly kind: MessageKind;
	readonly text: string;
	readonly createdAt: Instant;
}
