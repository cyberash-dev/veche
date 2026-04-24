import { ValidationError } from "../../../shared/errors/DomainError.js";
import type { Instant } from "../../../shared/types/instant.js";
import { asInstant } from "../../../shared/types/instant.js";
import type {
	ListMeetingsResult,
	MeetingStorePort,
} from "../../persistence/ports/MeetingStorePort.js";
import { ListMeetingsDefaultLimit } from "./constants.js";

export interface ListMeetingsQuery {
	readonly status?: "active" | "ended" | "all";
	readonly createdAfter?: string;
	readonly createdBefore?: string;
	readonly limit?: number;
	readonly cursor?: string;
}

export class ListMeetingsUseCase {
	constructor(private readonly deps: { readonly store: MeetingStorePort }) {}

	async execute(query: ListMeetingsQuery): Promise<ListMeetingsResult> {
		const limit = query.limit ?? ListMeetingsDefaultLimit;
		if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
			throw new ValidationError("limit must be 1..100");
		}
		const after = this.parseInstant(query.createdAfter, "createdAfter");
		const before = this.parseInstant(query.createdBefore, "createdBefore");
		if (after && before && after >= before) {
			throw new ValidationError("createdAfter must be strictly before createdBefore");
		}
		const status = query.status === "all" ? undefined : (query.status ?? "active");
		return this.deps.store.listMeetings({
			...(status !== undefined ? { status } : {}),
			...(after !== undefined ? { createdAfter: after } : {}),
			...(before !== undefined ? { createdBefore: before } : {}),
			limit,
			...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
		});
	}

	private parseInstant(raw: string | undefined, field: string): Instant | undefined {
		if (raw === undefined) {
			return undefined;
		}
		const parsed = Date.parse(raw);
		if (Number.isNaN(parsed)) {
			throw new ValidationError(`${field} must be a valid ISO-8601 instant`);
		}
		return asInstant(new Date(parsed).toISOString());
	}
}
