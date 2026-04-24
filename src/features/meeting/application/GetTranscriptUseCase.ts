import { ValidationError } from "../../../shared/errors/DomainError.js";
import type { MeetingId } from "../../../shared/types/ids.js";
import type { MeetingStorePort } from "../../persistence/ports/MeetingStorePort.js";
import type { Message } from "../domain/Message.js";
import { GetResponseDefaultLimit } from "./constants.js";

export interface GetTranscriptQuery {
	readonly meetingId: MeetingId;
	readonly cursor?: string;
	readonly limit?: number;
}

export interface GetTranscriptResult {
	readonly meetingId: MeetingId;
	readonly status: "active" | "ended";
	readonly messages: readonly Message[];
	readonly nextCursor: string;
	readonly hasMore: boolean;
}

export class GetTranscriptUseCase {
	constructor(private readonly deps: { readonly store: MeetingStorePort }) {}

	async execute(query: GetTranscriptQuery): Promise<GetTranscriptResult> {
		const limit = query.limit ?? GetResponseDefaultLimit;
		if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
			throw new ValidationError("limit must be 1..500");
		}
		const snap = await this.deps.store.loadMeeting(query.meetingId);
		const page = await this.deps.store.readMessagesSince({
			meetingId: query.meetingId,
			...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
			limit,
		});
		return {
			meetingId: query.meetingId,
			status: snap.meeting.status,
			messages: page.messages,
			nextCursor: page.nextCursor,
			hasMore: page.hasMore,
		};
	}
}
