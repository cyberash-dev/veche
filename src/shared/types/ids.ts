declare const brand: unique symbol;

export type Branded<T, Brand extends string> = T & { readonly [brand]: Brand };

export type MeetingId = Branded<string, "MeetingId">;
export type JobId = Branded<string, "JobId">;
export type MessageId = Branded<string, "MessageId">;
export type ParticipantId = Branded<string, "ParticipantId">;
export type SessionId = Branded<string, "SessionId">;

export const asMeetingId = (v: string): MeetingId => v as MeetingId;
export const asJobId = (v: string): JobId => v as JobId;
export const asMessageId = (v: string): MessageId => v as MessageId;
export const asParticipantId = (v: string): ParticipantId => v as ParticipantId;
export const asSessionId = (v: string): SessionId => v as SessionId;

export const PARTICIPANT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
