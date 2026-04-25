import { describe, expect, it } from "vitest";
import type { MeetingSummary } from "../../../../features/persistence/ports/MeetingStorePort.js";
import { asMeetingId, asParticipantId } from "../../../../shared/types/ids.js";
import { asInstant } from "../../../../shared/types/instant.js";
import {
	diffMeetingList,
	indexSummaries,
	maxLastSeq,
	nextBackoff,
	WATCH_BACKOFF_CAP_MS,
	WATCH_POLL_MS,
} from "../MeetingPoller.js";

const summary = (overrides: Partial<MeetingSummary> = {}): MeetingSummary => ({
	meetingId: asMeetingId("m-1"),
	title: "demo",
	status: "active",
	createdAt: asInstant("2026-04-25T10:00:00.000Z"),
	endedAt: null,
	participants: [
		{
			id: asParticipantId("alice"),
			role: "facilitator",
			adapter: null,
			status: "active",
		},
	],
	lastSeq: 0,
	openJobCount: 0,
	...overrides,
});

describe("diffMeetingList", () => {
	it("returns no events when nothing changed", () => {
		const prev = indexSummaries([summary({ meetingId: asMeetingId("m-1") })]);
		const next = [summary({ meetingId: asMeetingId("m-1") })];
		const result = diffMeetingList(prev, next);
		expect(result.added).toEqual([]);
		expect(result.updated).toEqual([]);
	});

	it("emits meeting.added when a new id appears", () => {
		const prev = indexSummaries([]);
		const next = [
			summary({ meetingId: asMeetingId("m-1") }),
			summary({
				meetingId: asMeetingId("m-2"),
				createdAt: asInstant("2026-04-25T10:01:00.000Z"),
			}),
		];
		const result = diffMeetingList(prev, next);
		expect(result.added).toHaveLength(2);
		expect(result.updated).toEqual([]);
		expect(result.added[0]?.meetingId).toBe(asMeetingId("m-1"));
		expect(result.added[1]?.meetingId).toBe(asMeetingId("m-2"));
	});

	it("emits meeting.updated only on status / lastSeq / openJobCount change", () => {
		const prev = indexSummaries([summary({ meetingId: asMeetingId("m-1"), lastSeq: 4 })]);
		const next = [summary({ meetingId: asMeetingId("m-1"), lastSeq: 5 })];
		const result = diffMeetingList(prev, next);
		expect(result.updated).toHaveLength(1);
		expect(result.updated[0]?.lastSeq).toBe(5);
	});

	it("does not emit meeting.updated for unrelated field changes", () => {
		const prev = indexSummaries([summary({ meetingId: asMeetingId("m-1"), title: "old" })]);
		const next = [summary({ meetingId: asMeetingId("m-1"), title: "new" })];
		const result = diffMeetingList(prev, next);
		expect(result.updated).toEqual([]);
	});

	it("emits added sorted by createdAt ascending", () => {
		const prev = indexSummaries([]);
		const next = [
			summary({
				meetingId: asMeetingId("z"),
				createdAt: asInstant("2026-04-25T10:00:02.000Z"),
			}),
			summary({
				meetingId: asMeetingId("a"),
				createdAt: asInstant("2026-04-25T10:00:01.000Z"),
			}),
		];
		const result = diffMeetingList(prev, next);
		expect(result.added.map((s) => s.meetingId)).toEqual([asMeetingId("a"), asMeetingId("z")]);
	});
});

describe("maxLastSeq", () => {
	it("returns -1 for an empty list", () => {
		expect(maxLastSeq([])).toBe(-1);
	});

	it("picks the maximum lastSeq", () => {
		const summaries = [
			summary({ meetingId: asMeetingId("a"), lastSeq: 1 }),
			summary({ meetingId: asMeetingId("b"), lastSeq: 8 }),
			summary({ meetingId: asMeetingId("c"), lastSeq: 3 }),
		];
		expect(maxLastSeq(summaries)).toBe(8);
	});
});

describe("nextBackoff", () => {
	it("doubles the current delay", () => {
		expect(nextBackoff(WATCH_POLL_MS)).toBe(WATCH_POLL_MS * 2);
	});

	it("caps at WATCH_BACKOFF_CAP_MS", () => {
		expect(nextBackoff(WATCH_BACKOFF_CAP_MS)).toBe(WATCH_BACKOFF_CAP_MS);
	});
});
