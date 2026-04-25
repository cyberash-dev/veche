import { createHash } from "node:crypto";
import type { Participant } from "../../../../features/meeting/domain/Participant.js";

/** HTML escaping sufficient for text content and double-quoted attribute values. */
export const escapeHtml = (raw: string): string =>
	raw
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

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

const SAFE_URL = /^(https?:|mailto:)/i;

const ALLOWED_INLINE_HTML = [
	"b",
	"strong",
	"i",
	"em",
	"u",
	"s",
	"del",
	"ins",
	"code",
	"sub",
	"sup",
	"kbd",
	"mark",
	"small",
	"abbr",
];
const ALLOWED_VOID_HTML = ["br", "hr"];

const SKIP_HTML_REGIONS = /(<pre\b[^>]*>[\s\S]*?<\/pre>|<code\b[^>]*>[\s\S]*?<\/code>)/g;

/**
 * Selectively un-escape a small allowlist of inline HTML tags after the markdown pipeline.
 * Only bare tag forms (no attributes) are un-escaped; everything else stays escaped. Content
 * inside `<code>…</code>` and `<pre>…</pre>` regions is left untouched so code samples that
 * mention `<br>` etc. remain literal.
 */
const unescapeAllowlistedHtml = (s: string): string => {
	const parts = s.split(SKIP_HTML_REGIONS);
	return parts
		.map((part, idx) => {
			// Odd-indexed parts are matched skip regions (<pre>…</pre> / <code>…</code>) — leave.
			if (idx % 2 === 1) {
				return part;
			}
			let out = part;
			for (const tag of ALLOWED_INLINE_HTML) {
				out = out.replace(new RegExp(`&lt;${tag}&gt;`, "g"), `<${tag}>`);
				out = out.replace(new RegExp(`&lt;/${tag}&gt;`, "g"), `</${tag}>`);
			}
			for (const tag of ALLOWED_VOID_HTML) {
				out = out.replace(new RegExp(`&lt;${tag}\\s*/?&gt;`, "g"), `<${tag}>`);
			}
			return out;
		})
		.join("");
};

/**
 * Inline-level Markdown → HTML on a single raw line. The implementation escapes the input
 * first, then applies regex-based marker transforms to the escaped text. The output is safe
 * to interpolate into HTML directly: any `<`, `>`, `&`, `"`, `'` from the source are already
 * encoded, and the only tags introduced are `<code>`, `<strong>`, `<em>`, `<a href>` from
 * the markdown markers themselves.
 *
 * Order matters: inline code first (so markers inside backticks survive), then bold (so
 * `**` is not eaten by `*` italic), then italic, then links.
 */
const renderInlineMarkdown = (raw: string): string => {
	let out = escapeHtml(raw);
	out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
	out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
	out = out.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
	out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
	out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
	out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
		if (SAFE_URL.test(url)) {
			return `<a href="${url}">${label}</a>`;
		}
		return `[${label}](${url})`;
	});
	// Selectively un-escape the small allowlist of inline HTML tags agents commonly emit
	// (<br>, <b>, <i>, <u>, etc.). Content inside <code>/<pre> stays escaped.
	out = unescapeAllowlistedHtml(out);
	return out;
};

const CODE_FENCE_RE = /^( {0,3})```(.*)$/;
const CODE_FENCE_CLOSE_RE = /^ {0,3}```\s*$/;

const parseCodeFence = (line: string): { indent: number; lang: string } | null => {
	const match = CODE_FENCE_RE.exec(line);
	if (match === null) {
		return null;
	}
	return {
		indent: (match[1] ?? "").length,
		lang: (match[2] ?? "").trim(),
	};
};

const stripFenceIndent = (line: string, indent: number): string => {
	let count = 0;
	while (count < indent && line[count] === " ") {
		count += 1;
	}
	return line.slice(count);
};

const isBlockBoundary = (line: string): boolean =>
	line.trim() === "" ||
	parseCodeFence(line) !== null ||
	/^#{1,3}\s/.test(line) ||
	line.startsWith("> ") ||
	/^[-*+]\s/.test(line) ||
	/^\d+\.\s/.test(line) ||
	/^(---+|___+)\s*$/.test(line);

/** GFM table detection. A line starting with `|` and containing at least one more `|`. */
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
/** Separator line: each cell is dashes (≥ 3) optionally wrapped by `:` for alignment. */
const TABLE_SEP_RE = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/;

const isTableStart = (line: string, nextLine: string): boolean =>
	TABLE_ROW_RE.test(line) && TABLE_SEP_RE.test(nextLine);

/** Split a `| a | b | c |` row into trimmed cell strings. */
const splitTableCells = (line: string): string[] => {
	const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
	return trimmed.split("|").map((c) => c.trim());
};

/**
 * Block-level Markdown → HTML for the small subset documented in
 * `spec/features/meeting/show-meeting-cli.usecase.md`. Pipeline:
 *
 * 1. Block detection runs on the **raw** source — markers like `> `, `# `, `- ` are read as
 *    written. The parser never produces HTML tags from anything other than the markers it
 *    explicitly recognises.
 * 2. Inline content inside each block is escaped (`escapeHtml`) before inline marker
 *    transforms add `<strong>`/`<em>`/`<code>`/`<a>`. So message text cannot inject HTML.
 * 3. Code-block bodies are escaped verbatim and never receive inline transforms.
 *
 * The only tags introduced by this converter are: `<p>`, `<pre>`, `<code>`, `<ul>`, `<ol>`,
 * `<li>`, `<blockquote>`, `<h1>`–`<h3>`, `<hr>`, `<strong>`, `<em>`, `<a href="…">`, `<br>`.
 * Anything outside the subset is rendered as escaped literal text — never as raw HTML.
 */
export const renderMarkdownToHtml = (raw: string): string => {
	const lines = raw.split("\n");
	// Helper: line at idx, or empty string when past the end. The `?? ""` keeps the type
	// `string` (no non-null assertion needed) and matches the loop precondition checks.
	const at = (idx: number): string => lines[idx] ?? "";
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = at(i);

		// Fenced code block — preserved verbatim, no inline transforms inside.
		const fence = parseCodeFence(line);
		if (fence !== null) {
			const codeLines: string[] = [];
			i += 1;
			while (i < lines.length && !CODE_FENCE_CLOSE_RE.test(at(i))) {
				codeLines.push(stripFenceIndent(at(i), fence.indent));
				i += 1;
			}
			i += 1; // skip closing fence (or EOF)
			const cls = fence.lang ? ` class="lang-${escapeHtml(fence.lang)}"` : "";
			out.push(`<pre><code${cls}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
			continue;
		}

		// Heading h1..h3
		const heading = /^(#{1,3})\s+(.+)$/.exec(line);
		if (heading) {
			const level = (heading[1] ?? "").length;
			out.push(`<h${level}>${renderInlineMarkdown(heading[2] ?? "")}</h${level}>`);
			i += 1;
			continue;
		}

		// Horizontal rule
		if (/^(---+|___+)\s*$/.test(line)) {
			out.push("<hr>");
			i += 1;
			continue;
		}

		// Blockquote (consumes consecutive `> ` lines)
		if (line.startsWith("> ")) {
			const quoteLines: string[] = [];
			while (i < lines.length && at(i).startsWith("> ")) {
				quoteLines.push(at(i).slice(2));
				i += 1;
			}
			out.push(`<blockquote>${renderInlineMarkdown(quoteLines.join("<br>"))}</blockquote>`);
			continue;
		}

		// GFM table — header row + separator row + 0..N data rows.
		if (isTableStart(line, at(i + 1))) {
			const headers = splitTableCells(line);
			i += 2; // skip header + separator
			const rows: string[][] = [];
			while (i < lines.length && TABLE_ROW_RE.test(at(i)) && !TABLE_SEP_RE.test(at(i))) {
				rows.push(splitTableCells(at(i)));
				i += 1;
			}
			const thead = `<thead><tr>${headers
				.map((c) => `<th>${renderInlineMarkdown(c)}</th>`)
				.join("")}</tr></thead>`;
			const tbody =
				rows.length > 0
					? `<tbody>${rows
							.map(
								(r) =>
									`<tr>${r
										.map((c) => `<td>${renderInlineMarkdown(c)}</td>`)
										.join("")}</tr>`,
							)
							.join("")}</tbody>`
					: "";
			out.push(`<table>${thead}${tbody}</table>`);
			continue;
		}

		// Unordered list (consumes consecutive `- `, `* `, `+ ` lines)
		if (/^[-*+]\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^[-*+]\s+/.test(at(i))) {
				const content = at(i).replace(/^[-*+]\s+/, "");
				items.push(`<li>${renderInlineMarkdown(content)}</li>`);
				i += 1;
			}
			out.push(`<ul>${items.join("")}</ul>`);
			continue;
		}

		// Ordered list (consumes consecutive `\d+. ` lines)
		if (/^\d+\.\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^\d+\.\s+/.test(at(i))) {
				const content = at(i).replace(/^\d+\.\s+/, "");
				items.push(`<li>${renderInlineMarkdown(content)}</li>`);
				i += 1;
			}
			out.push(`<ol>${items.join("")}</ol>`);
			continue;
		}

		// Empty line — paragraph break
		if (line.trim() === "") {
			i += 1;
			continue;
		}

		// Paragraph: collect non-empty, non-block lines. Stop also on table starts so a table
		// following a paragraph without a blank line between them is still detected.
		const paraLines: string[] = [];
		while (i < lines.length && !isBlockBoundary(at(i)) && !isTableStart(at(i), at(i + 1))) {
			paraLines.push(at(i));
			i += 1;
		}
		if (paraLines.length > 0) {
			out.push(`<p>${renderInlineMarkdown(paraLines.join("<br>"))}</p>`);
		}
	}
	return out.join("\n");
};
