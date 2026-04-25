import type { ServerResponse } from "node:http";
import { MeetingNotFound } from "../../../features/meeting/domain/errors.js";
import type { MeetingStorePort } from "../../../features/persistence/ports/MeetingStorePort.js";
import { asMeetingId } from "../../../shared/types/ids.js";
import { type MessageDto, messageDto, type SummaryDto, snapshotDto, summaryDto } from "./dto.js";

const MAX_LIST_LIMIT = 200;
const MAX_MESSAGES_LIMIT = 500;
const DEFAULT_LIST_LIMIT = 100;
const DEFAULT_MESSAGES_LIMIT = 200;

const writeJson = (response: ServerResponse, status: number, body: unknown): void => {
	const payload = `${JSON.stringify(body, null, 2)}\n`;
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(payload, "utf8"),
		"Cache-Control": "no-cache",
		"X-Content-Type-Options": "nosniff",
	});
	response.end(payload);
};

const parseStatusFilter = (raw: string | null): "active" | "ended" | undefined | "invalid" => {
	if (raw === null || raw === "all") {
		return undefined;
	}
	if (raw === "active" || raw === "ended") {
		return raw;
	}
	return "invalid";
};

const parseLimit = (raw: string | null, fallback: number, max: number): number | "invalid" => {
	if (raw === null) {
		return fallback;
	}
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 1) {
		return "invalid";
	}
	return Math.min(n, max);
};

export const handleListMeetings = async (
	store: MeetingStorePort,
	url: URL,
	response: ServerResponse,
): Promise<void> => {
	const statusFilter = parseStatusFilter(url.searchParams.get("status"));
	if (statusFilter === "invalid") {
		writeJson(response, 400, { error: "invalid status" });
		return;
	}
	const limit = parseLimit(url.searchParams.get("limit"), DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
	if (limit === "invalid") {
		writeJson(response, 400, { error: "invalid limit" });
		return;
	}
	const cursor = url.searchParams.get("cursor");
	const result = await store.listMeetings({
		limit,
		...(statusFilter !== undefined ? { status: statusFilter } : {}),
		...(cursor !== null ? { cursor } : {}),
	});
	const summaries: SummaryDto[] = result.summaries.map(summaryDto);
	writeJson(response, 200, { summaries, nextCursor: result.nextCursor });
};

export const handleGetMeeting = async (
	store: MeetingStorePort,
	rawId: string,
	response: ServerResponse,
): Promise<void> => {
	try {
		const snapshot = await store.loadMeeting(asMeetingId(rawId));
		writeJson(response, 200, snapshotDto(snapshot));
	} catch (err) {
		if (err instanceof MeetingNotFound) {
			writeJson(response, 404, { error: "meeting not found", meetingId: rawId });
			return;
		}
		throw err;
	}
};

export const handleGetMessages = async (
	store: MeetingStorePort,
	rawId: string,
	url: URL,
	response: ServerResponse,
): Promise<void> => {
	const limit = parseLimit(
		url.searchParams.get("limit"),
		DEFAULT_MESSAGES_LIMIT,
		MAX_MESSAGES_LIMIT,
	);
	if (limit === "invalid") {
		writeJson(response, 400, { error: "invalid limit" });
		return;
	}
	const cursor = url.searchParams.get("cursor");
	try {
		const meetingId = asMeetingId(rawId);
		await store.loadMeeting(meetingId);
		const page = await store.readMessagesSince({
			meetingId,
			limit,
			...(cursor !== null ? { cursor } : {}),
		});
		const messages: MessageDto[] = page.messages.map(messageDto);
		writeJson(response, 200, {
			messages,
			nextCursor: page.nextCursor,
			hasMore: page.hasMore,
		});
	} catch (err) {
		if (err instanceof MeetingNotFound) {
			writeJson(response, 404, { error: "meeting not found", meetingId: rawId });
			return;
		}
		throw err;
	}
};

export const writeNotFound = (response: ServerResponse): void => {
	writeJson(response, 404, { error: "not found" });
};

export const writeWrongHost = (response: ServerResponse): void => {
	writeJson(response, 421, { error: "wrong host" });
};

export const writeServerError = (response: ServerResponse, message: string): void => {
	writeJson(response, 500, { error: "internal", message });
};
