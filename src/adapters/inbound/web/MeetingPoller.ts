import type { MeetingSummary } from "../../../features/persistence/ports/MeetingStorePort.js";

export const WATCH_POLL_MS = 750;
export const WATCH_KEEPALIVE_MS = 15_000;
export const WATCH_BACKOFF_CAP_MS = 8_000;
export const WATCH_LIST_LIMIT = 200;
export const WATCH_MESSAGE_PAGE_LIMIT = 200;

export interface MeetingListDiff {
	readonly added: readonly MeetingSummary[];
	readonly updated: readonly MeetingSummary[];
}

const summaryHasChanged = (prev: MeetingSummary, next: MeetingSummary): boolean =>
	prev.status !== next.status ||
	prev.lastSeq !== next.lastSeq ||
	prev.openJobCount !== next.openJobCount;

export const diffMeetingList = (
	prev: ReadonlyMap<string, MeetingSummary>,
	next: readonly MeetingSummary[],
): MeetingListDiff => {
	const added: MeetingSummary[] = [];
	const updated: MeetingSummary[] = [];
	for (const summary of next) {
		const before = prev.get(summary.meetingId);
		if (before === undefined) {
			added.push(summary);
		} else if (summaryHasChanged(before, summary)) {
			updated.push(summary);
		}
	}
	added.sort((a, b) => {
		if (a.createdAt !== b.createdAt) {
			return a.createdAt < b.createdAt ? -1 : 1;
		}
		return a.meetingId < b.meetingId ? -1 : 1;
	});
	updated.sort((a, b) => (a.meetingId < b.meetingId ? -1 : 1));
	return { added, updated };
};

export const indexSummaries = (
	summaries: readonly MeetingSummary[],
): Map<string, MeetingSummary> => {
	const map = new Map<string, MeetingSummary>();
	for (const summary of summaries) {
		map.set(summary.meetingId, summary);
	}
	return map;
};

export const maxLastSeq = (summaries: readonly MeetingSummary[]): number => {
	let max = -1;
	for (const summary of summaries) {
		if (summary.lastSeq > max) {
			max = summary.lastSeq;
		}
	}
	return max;
};

export const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const onAbort = (): void => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});

export const nextBackoff = (current: number): number =>
	Math.min(WATCH_BACKOFF_CAP_MS, Math.max(WATCH_POLL_MS, current * 2));
