import { describe, expect, it } from "vitest";
import { renderHtml } from "../renderers/html.js";
import { renderJson } from "../renderers/json.js";
import { renderMarkdown } from "../renderers/markdown.js";
import { renderText } from "../renderers/text.js";
import { fixtureInput } from "./fixtures.js";

describe("text renderer", () => {
	it("includes header + rounds + author markers", () => {
		const out = renderText(fixtureInput());
		expect(out).toContain("tabs vs spaces");
		expect(out).toContain("meetingId: fixture-meeting-1");
		expect(out).toContain("── Opening");
		expect(out).toContain("── Round 1");
		expect(out).toContain("── Round 2");
		expect(out).toContain("[r1 codex speech]");
		expect(out).toContain("[r2 codex passed]");
		expect(out).toContain("spaces — it's the ecosystem default.");
		expect(out).toContain("Symmetric peer deliberation");
	});

	it("respects useColor flag", () => {
		const coloured = renderText(fixtureInput({ useColor: true }));
		const plain = renderText(fixtureInput({ useColor: false }));
		expect(coloured).toContain("\x1b[");
		expect(plain).not.toContain("\x1b[");
	});
});

describe("markdown renderer", () => {
	it("produces GitHub-flavoured headings + blockquotes", () => {
		const out = renderMarkdown(fixtureInput());
		expect(out).toMatch(/^# tabs vs spaces/m);
		expect(out).toContain("### Round 1");
		expect(out).toContain("### Round 2");
		expect(out).toContain("**codex**");
		expect(out).toContain("_codex passed._");
		expect(out).toContain("Symmetric peer deliberation");
	});
});

describe("json renderer", () => {
	it("emits valid JSON with stable top-level keys", () => {
		const out = renderJson(fixtureInput());
		const parsed = JSON.parse(out);
		expect(parsed.meeting.id).toBe("fixture-meeting-1");
		expect(parsed.participants).toHaveLength(3);
		expect(parsed.jobs).toHaveLength(1);
		expect(parsed.messages).toHaveLength(5);
		expect(parsed.generator.name).toBe("veche");
	});
});

describe("html renderer", () => {
	const html = renderHtml(fixtureInput());

	it("is a self-contained document with inline CSS", () => {
		expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
		expect(html).toContain("<style>");
		expect(html).toContain("</style>");
		expect(html).toContain('<meta charset="utf-8">');
	});

	it("never loads remote resources", () => {
		expect(html).not.toMatch(/<script[\s>]/);
		expect(html).not.toMatch(/src="https?:/);
		expect(html).not.toMatch(/href="https?:/);
		expect(html).not.toMatch(/<link\s+[^>]*rel="stylesheet"/);
	});

	it("escapes user-controlled text", () => {
		const injected = renderHtml(
			fixtureInput({
				meeting: {
					...fixtureInput().meeting,
					title: '<script>alert("xss")</script>',
				},
			}),
		);
		expect(injected).not.toContain("<script>alert");
		expect(injected).toContain("&lt;script&gt;alert");
	});

	it("renders rounds as collapsible details and includes all authors", () => {
		expect(html).toMatch(/<details class="round"/);
		expect(html).toContain(">Opening</summary>");
		expect(html).toContain(">Round 1</summary>");
		expect(html).toContain(">Round 2</summary>");
		expect(html).toContain("codex");
		expect(html).toContain("claude");
		// Pass pill appears, not raw token
		expect(html).toContain("passed</span>");
		expect(html).not.toContain("<PASS/>");
	});

	it("gives each non-facilitator participant a distinct colour", () => {
		const memberBubbles = html.match(/class="bubble" style="background:([^"]+)"/g);
		expect(memberBubbles).not.toBeNull();
		// at least two distinct colours among member bubbles
		const uniq = new Set(memberBubbles ?? []);
		expect(uniq.size).toBeGreaterThanOrEqual(2);
	});

	it("renders the facilitator's opening message as a centered, full-width bubble", () => {
		expect(html).toContain('<div class="msg facilitator">');
		// Members render as left/right alternates, never as facilitator class.
		const facilitatorBubbles = html.match(/<div class="msg facilitator">/g) ?? [];
		expect(facilitatorBubbles).toHaveLength(1); // only round-0 opening
	});

	it("includes the symmetric-peer caption in the header card", () => {
		expect(html).toContain("Symmetric peer deliberation");
		expect(html).toContain("2 members + 1 facilitator");
	});
});

// Regression: the Jobs section must show the actual round count from `Job.rounds`, not the
// log position `Job.lastSeq`. Earlier the html renderer's column header said "rounds" but the
// cell value was `job.lastSeq`, so a 3-round meeting that touched seq=16 in the event log
// rendered as "rounds: 16". The fixture sets rounds=2, lastSeq=7 — distinct values catch the
// bug deterministically.
describe("Jobs section — rounds vs lastSeq distinction", () => {
	const input = fixtureInput();

	it("html: rounds column shows job.rounds, lastSeq column shows job.lastSeq", () => {
		const html = renderHtml(input);
		// Header has both columns.
		expect(html).toContain(
			"<thead><tr><th>id</th><th>status</th><th>reason</th><th>rounds</th><th>lastSeq</th><th>finished</th></tr></thead>",
		);
		// The job row contains the rounds cell (2) BEFORE the lastSeq cell (7).
		expect(html).toMatch(/<td>2<\/td><td>7<\/td>/);
	});

	it("text: rounds=N lastSeq=N appears, not just lastSeq=N", () => {
		const text = renderText(input);
		expect(text).toContain("rounds=2");
		expect(text).toContain("lastSeq=7");
	});

	it("markdown: rounds and lastSeq are distinct columns", () => {
		const md = renderMarkdown(input);
		expect(md).toContain("| jobId | status | reason | rounds | lastSeq |");
		// Row contains both the rounds (2) and lastSeq (7) values in their respective cells.
		expect(md).toMatch(/\| all-passed \| 2 \| 7 \|/);
	});
});

describe("html renderer — markdown in speech bubbles", () => {
	const renderWithText = (memberText: string): string => {
		const base = fixtureInput();
		const messages = base.messages.map((m, i) => (i === 1 ? { ...m, text: memberText } : m));
		return renderHtml({ ...base, messages });
	};

	it("renders **bold** as <strong>", () => {
		const html = renderWithText("Use **spaces**, not tabs.");
		expect(html).toContain("<strong>spaces</strong>");
		expect(html).not.toContain("**spaces**");
	});

	it("renders inline `code` as <code>", () => {
		const html = renderWithText("Prefer `argparse` for stdlib-only setups.");
		expect(html).toContain("<code>argparse</code>");
	});

	it("renders fenced ```code``` as <pre><code>", () => {
		const html = renderWithText("Example:\n```python\nimport argparse\n```");
		expect(html).toMatch(
			/<pre><code class="lang-python">[\s\S]*import argparse[\s\S]*<\/code><\/pre>/,
		);
	});

	it("renders fenced code blocks with up to three leading spaces before fences", () => {
		const html = renderWithText(
			"Но его вход должен быть не вся спека, а:\n   ```text\n   approved_diffs\n   public contracts\n   shared files touched\n   integration test failures\n   release constraints\n   ```",
		);
		expect(html).toContain('<pre><code class="lang-text">');
		expect(html).toContain("approved_diffs\npublic contracts\nshared files touched");
		expect(html).not.toContain("``<code>text");
		expect(html).not.toContain("approved_diffs&lt;br&gt;");
	});

	it("renders unordered lists as <ul><li>", () => {
		const html = renderWithText("Reasons:\n- Simplicity\n- Convention\n- Tooling");
		expect(html).toContain("<ul>");
		expect(html).toContain("<li>Simplicity</li>");
		expect(html).toContain("<li>Convention</li>");
	});

	it("renders ordered lists as <ol><li>", () => {
		const html = renderWithText("Steps:\n1. Pick a parser\n2. Define commands");
		expect(html).toContain("<ol>");
		expect(html).toContain("<li>Pick a parser</li>");
	});

	it("renders blockquotes as <blockquote>", () => {
		const html = renderWithText("> PEP 8 says spaces.");
		expect(html).toMatch(/<blockquote>PEP 8 says spaces\.<\/blockquote>/);
	});

	it("renders headings as <h1>..<h3>", () => {
		const html = renderWithText("# Verdict\n## Rationale\n### Caveats");
		expect(html).toContain("<h1>Verdict</h1>");
		expect(html).toContain("<h2>Rationale</h2>");
		expect(html).toContain("<h3>Caveats</h3>");
	});

	it("renders safe http links as <a href>", () => {
		const html = renderWithText("See [PEP 8](https://peps.python.org/pep-0008/).");
		expect(html).toContain('<a href="https://peps.python.org/pep-0008/">PEP 8</a>');
	});

	it("rejects javascript: links — renders them as escaped literal", () => {
		const html = renderWithText("[click](javascript:alert(1))");
		expect(html).not.toContain('<a href="javascript:');
		expect(html).not.toContain("onerror");
		// The literal must be present, escaped, in the output.
		expect(html).toContain("[click](javascript:alert(1))");
	});

	it("escapes HTML in markdown source — <script> never appears as a tag", () => {
		const html = renderWithText("Try **<script>alert(1)</script>** instead.");
		expect(html).not.toMatch(/<script[\s>]/);
		expect(html).toContain("<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>");
	});

	it("un-escapes <br> agents emit for soft line breaks", () => {
		const html = renderWithText("First line<br>second line<br/>third<br />fourth");
		expect(html).toContain("First line<br>second line<br>third<br>fourth");
		expect(html).not.toContain("&lt;br&gt;");
	});

	it("un-escapes allowlisted inline tags (<b>, <i>, <u>, <kbd>, <sup>)", () => {
		const html = renderWithText(
			"Use <b>bold</b>, <i>italic</i>, <kbd>Ctrl</kbd>+<kbd>C</kbd>, x<sup>2</sup>.",
		);
		expect(html).toContain("<b>bold</b>");
		expect(html).toContain("<i>italic</i>");
		expect(html).toContain("<kbd>Ctrl</kbd>");
		expect(html).toContain("<sup>2</sup>");
		expect(html).not.toContain("&lt;b&gt;");
		expect(html).not.toContain("&lt;kbd&gt;");
	});

	it("keeps non-allowlisted tags escaped (<area>, <feature>, custom)", () => {
		const html = renderWithText("Pass `<area>` and `<feature>` and <custom>raw</custom> too.");
		// <area>/<feature> appear in inline code → escaped, NOT un-escaped.
		expect(html).toContain("<code>&lt;area&gt;</code>");
		expect(html).toContain("<code>&lt;feature&gt;</code>");
		// <custom> not in allowlist → escaped outside code.
		expect(html).toContain("&lt;custom&gt;raw&lt;/custom&gt;");
		expect(html).not.toContain("<custom>");
	});

	it("rejects allowlisted tags WITH attributes (no XSS via <b style>)", () => {
		const html = renderWithText('Watch <b style="color:red">this</b> and <br data-evil="x">.');
		// Attributes are not in the un-escape pattern → stays escaped.
		expect(html).not.toContain('<b style="color:red">');
		expect(html).not.toContain("<br data-evil");
		expect(html).toContain("&lt;b style=&quot;color:red&quot;&gt;");
		expect(html).toContain("&lt;br data-evil=&quot;x&quot;&gt;");
	});

	it("preserves <br> as literal text inside inline code spans", () => {
		const html = renderWithText("Use `<br>` for line breaks in HTML.");
		expect(html).toContain("<code>&lt;br&gt;</code>");
		// Outside the code span, no stray <br> from the example survives un-escape.
		const outsideCode = html.replace(/<code>[\s\S]*?<\/code>/g, "");
		expect(outsideCode).not.toContain("<br>");
	});

	it("preserves angle brackets verbatim inside fenced code blocks", () => {
		const html = renderWithText("Example:\n```html\n<br>\n<b>x</b>\n```");
		expect(html).toMatch(
			/<pre><code class="lang-html">[\s\S]*&lt;br&gt;[\s\S]*&lt;b&gt;x&lt;\/b&gt;[\s\S]*<\/code><\/pre>/,
		);
	});

	it("preserves multiple paragraphs as <p> blocks", () => {
		const html = renderWithText("First paragraph.\n\nSecond paragraph.");
		const paragraphs = html.match(/<p>[^<]*paragraph\.<\/p>/g) ?? [];
		expect(paragraphs.length).toBeGreaterThanOrEqual(2);
	});

	it("renders GFM tables with <thead>/<tbody>/<tr>/<th>/<td>", () => {
		const html = renderWithText(
			"| Stage | Input | Output |\n|---|---|---|\n| Intake | raw ask | problem brief |\n| Spec | brief | use cases |",
		);
		expect(html).toContain("<table>");
		expect(html).toContain(
			"<thead><tr><th>Stage</th><th>Input</th><th>Output</th></tr></thead>",
		);
		expect(html).toContain("<tbody>");
		expect(html).toContain("<tr><td>Intake</td><td>raw ask</td><td>problem brief</td></tr>");
		expect(html).toContain("<tr><td>Spec</td><td>brief</td><td>use cases</td></tr>");
	});

	it("renders inline markdown inside table cells (bold, code, links)", () => {
		const html = renderWithText(
			"| Name | Desc |\n|---|---|\n| **Alice** | see `foo.ts` |\n| Bob | [docs](https://example.com) |",
		);
		expect(html).toContain("<td><strong>Alice</strong></td>");
		expect(html).toContain("<td>see <code>foo.ts</code></td>");
		expect(html).toContain('<td>Bob</td><td><a href="https://example.com">docs</a></td>');
	});

	it("detects a table that follows a paragraph without a blank line", () => {
		const html = renderWithText("Here is the plan:\n| a | b |\n|---|---|\n| 1 | 2 |");
		expect(html).toContain("<p>Here is the plan:</p>");
		expect(html).toContain("<table>");
		expect(html).toContain("<td>1</td><td>2</td>");
	});

	it("does not detect a lone `|` line as a table", () => {
		const html = renderWithText("Use `a | b` to pipe output.");
		expect(html).not.toContain("<table>");
		expect(html).toContain("<code>a | b</code>");
	});

	it("requires a dashed separator — bare header stays paragraph", () => {
		const html = renderWithText("| Name | Value |\nsome description");
		expect(html).not.toContain("<table>");
		expect(html).toContain("<p>");
	});

	it("does not apply markdown to system messages", () => {
		const base = fixtureInput();
		const messages = base.messages.map((m, i) =>
			i === 3
				? {
						...m,
						kind: "system" as const,
						author: "system" as const,
						text: "**not bold**",
					}
				: m,
		);
		const html = renderHtml({ ...base, messages });
		expect(html).toContain('<div class="system">⚠ **not bold**</div>');
	});
});
