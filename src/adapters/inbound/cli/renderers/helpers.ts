import { createHash } from "node:crypto";
import type { Participant } from "../../../../features/meeting/domain/Participant.js";

export { escapeHtml, renderMarkdownToHtml } from "../../../../shared/markdown/markdownToHtml.js";

/**
 * Deterministic pastel HSL for a participantId.
 * Facilitator gets a neutral tone regardless of id.
 */
export const participantColor = (participant: Participant): string => {
	if (participant.role === "facilitator") {
		return "hsl(0, 0%, 93%)";
	}
	const digest = createHash("sha1").update(participant.id).digest();
	// first 2 bytes → 0..65535 → mapped to 0..359
	const hue = ((digest[0]! << 8) | digest[1]!) % 360;
	return `hsl(${hue}, 60%, 86%)`;
};

/** ANSI wrappers — no-ops when useColor is false. */
export const ansi = (useColor: boolean) => ({
	bold: (s: string): string => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
	dim: (s: string): string => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
	green: (s: string): string => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
	grey: (s: string): string => (useColor ? `\x1b[90m${s}\x1b[0m` : s),
	yellow: (s: string): string => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
	red: (s: string): string => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
	cyan: (s: string): string => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
});

/** Group messages by round number, preserving within-round seq order. */
export const groupByRound = <T extends { readonly round: number; readonly seq: number }>(
	messages: readonly T[],
): Array<{ round: number; messages: T[] }> => {
	const sorted = [...messages].sort((a, b) => a.seq - b.seq);
	const buckets = new Map<number, T[]>();
	for (const m of sorted) {
		const list = buckets.get(m.round) ?? [];
		list.push(m);
		buckets.set(m.round, list);
	}
	return Array.from(buckets.entries())
		.sort((a, b) => a[0] - b[0])
		.map(([round, list]) => ({ round, messages: list }));
};

/** Truncate a string with an ellipsis, preserving full string when shorter. */
export const truncate = (s: string, max: number): string =>
	s.length <= max ? s : `${s.slice(0, max - 1)}…`;
