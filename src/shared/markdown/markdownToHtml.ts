/**
 * Shared Markdown → HTML converter used by both the static `show --format=html` report and
 * the live `watch` SPA. Single source of truth — see
 * `spec/features/meeting/show-meeting-cli.usecase.md` → *Markdown rendering* for the
 * authoritative subset.
 *
 * Pipeline: escape every character of the source first, then introduce a fixed allowlist of
 * tags via regex transforms. Raw HTML in agent text is therefore impossible — the converter
 * only adds tags it produces itself.
 */

/** HTML escaping sufficient for text content and double-quoted attribute values. */
export const escapeHtml = (raw: string): string =>
	raw
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

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

const unescapeAllowlistedHtml = (s: string): string => {
	const parts = s.split(SKIP_HTML_REGIONS);
	return parts
		.map((part, idx) => {
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

const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/;

const isTableStart = (line: string, nextLine: string): boolean =>
	TABLE_ROW_RE.test(line) && TABLE_SEP_RE.test(nextLine);

const splitTableCells = (line: string): string[] => {
	const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
	return trimmed.split("|").map((c) => c.trim());
};

/**
 * Block-level Markdown → HTML for the small subset documented in
 * `spec/features/meeting/show-meeting-cli.usecase.md`. The converter only emits tags it
 * recognises; everything else passes through `escapeHtml` first.
 */
export const renderMarkdownToHtml = (raw: string): string => {
	const lines = raw.split("\n");
	const at = (idx: number): string => lines[idx] ?? "";
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = at(i);

		const fence = parseCodeFence(line);
		if (fence !== null) {
			const codeLines: string[] = [];
			i += 1;
			while (i < lines.length && !CODE_FENCE_CLOSE_RE.test(at(i))) {
				codeLines.push(stripFenceIndent(at(i), fence.indent));
				i += 1;
			}
			i += 1;
			const cls = fence.lang ? ` class="lang-${escapeHtml(fence.lang)}"` : "";
			out.push(`<pre><code${cls}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
			continue;
		}

		const heading = /^(#{1,3})\s+(.+)$/.exec(line);
		if (heading) {
			const level = (heading[1] ?? "").length;
			out.push(`<h${level}>${renderInlineMarkdown(heading[2] ?? "")}</h${level}>`);
			i += 1;
			continue;
		}

		if (/^(---+|___+)\s*$/.test(line)) {
			out.push("<hr>");
			i += 1;
			continue;
		}

		if (line.startsWith("> ")) {
			const quoteLines: string[] = [];
			while (i < lines.length && at(i).startsWith("> ")) {
				quoteLines.push(at(i).slice(2));
				i += 1;
			}
			out.push(`<blockquote>${renderInlineMarkdown(quoteLines.join("<br>"))}</blockquote>`);
			continue;
		}

		if (isTableStart(line, at(i + 1))) {
			const headers = splitTableCells(line);
			i += 2;
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

		if (line.trim() === "") {
			i += 1;
			continue;
		}

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
