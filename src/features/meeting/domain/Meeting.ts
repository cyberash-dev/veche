import type { MeetingId } from "../../../shared/types/ids.js";
import type { Instant } from "../../../shared/types/instant.js";
import type { Participant } from "./Participant.js";

export type MeetingStatus = "active" | "ended";

export interface Meeting {
	readonly id: MeetingId;
	readonly title: string;
	readonly status: MeetingStatus;
	readonly createdAt: Instant;
	readonly endedAt: Instant | null;
	readonly participants: readonly Participant[];
	readonly defaultMaxRounds: number;
}
