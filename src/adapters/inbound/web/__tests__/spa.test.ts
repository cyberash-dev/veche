import { describe, expect, it } from "vitest";
import { renderSpa } from "../spa/index.html.js";

describe("renderSpa", () => {
	const html = renderSpa("0.0.1-test");

	it("starts with a doctype and contains the app shell", () => {
		expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
		expect(html).toContain('<div id="app">');
		expect(html).toContain('id="meeting-list"');
		expect(html).toContain('id="transcript"');
	});

	it("contains exactly one inline <script> block", () => {
		const opens = html.match(/<script\b[^>]*>/g) ?? [];
		expect(opens).toHaveLength(1);
		expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
	});

	it("contains exactly one inline <style> block", () => {
		const opens = html.match(/<style\b[^>]*>/g) ?? [];
		expect(opens).toHaveLength(1);
	});

	it("does not reference any remote stylesheet, script, or font", () => {
		expect(html).not.toMatch(/<link\b[^>]*\brel=["']stylesheet["']/i);
		expect(html).not.toMatch(/href=["']https?:\/\//);
		expect(html).not.toMatch(/src=["']https?:\/\//);
		expect(html).not.toMatch(/@font-face/);
	});

	it("embeds the version into a meta tag", () => {
		expect(html).toContain('name="veche-version" content="0.0.1-test"');
	});

	it("contains the bottom human-turn composer affordances", () => {
		expect(html).toContain("participation-toggle");
		expect(html).toContain("turn-option");
		expect(html).toContain("send-human");
		expect(html).toContain('textContent = "Send"');
	});

	it("tracks the last rendered round without querying divider position", () => {
		expect(html).toContain("let lastRenderedRound = -1;");
		expect(html).toContain("if (m.round !== lastRenderedRound)");
		expect(html).not.toContain(".round-divider:last-of-type");
	});

	it("contains round progress and right-aligned human bubble styling", () => {
		expect(html).toContain("round-progress-label");
		expect(html).toContain('Round " + current + " / " + maxRounds');
		expect(html).toContain(".bubble.human-message.pass-message");
		expect(html).toContain("text-align: right");
	});
});
