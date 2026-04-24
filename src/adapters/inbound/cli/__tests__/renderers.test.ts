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
		expect(parsed.generator.name).toBe("ai-meeting");
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
