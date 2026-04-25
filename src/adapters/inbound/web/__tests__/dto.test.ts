import { describe, expect, it } from "vitest";
import type { Message } from "../../../../features/meeting/domain/Message.js";
import { renderMarkdownToHtml } from "../../../../shared/markdown/markdownToHtml.js";
import { asMeetingId, asMessageId, asParticipantId } from "../../../../shared/types/ids.js";
import { asInstant } from "../../../../shared/types/instant.js";
import { messageDto } from "../dto.js";

const baseMessage = (overrides: Partial<Message>): Message => ({
	id: asMessageId("m-1"),
	meetingId: asMeetingId("meet-1"),
	seq: 0,
	round: 1,
	author: asParticipantId("alice"),
	kind: "speech",
	text: "hello",
	createdAt: asInstant("2026-04-25T10:00:00.000Z"),
	...overrides,
});

describe("messageDto.htmlBody", () => {
	it("renders speech text via the shared Markdown converter", () => {
		const text = "**bold** and `code` and a [link](https://example.com)";
		const dto = messageDto(baseMessage({ kind: "speech", text }));
		expect(dto.htmlBody).toBe(renderMarkdownToHtml(text));
		expect(dto.htmlBody).toContain("<strong>bold</strong>");
		expect(dto.htmlBody).toContain("<code>code</code>");
		expect(dto.htmlBody).toContain('href="https://example.com"');
	});

	it("escapes HTML in the source so injection is impossible", () => {
		const dto = messageDto(baseMessage({ kind: "speech", text: "<script>alert(1)</script>" }));
		expect(dto.htmlBody).not.toContain("<script");
		expect(dto.htmlBody).toContain("&lt;script&gt;");
	});

	it("returns null for pass messages", () => {
		const dto = messageDto(baseMessage({ kind: "pass", text: "<PASS/>" }));
		expect(dto.htmlBody).toBeNull();
	});

	it("returns null for system messages", () => {
		const dto = messageDto(
			baseMessage({
				kind: "system",
				author: asParticipantId("system"),
				text: "agent dropped",
			}),
		);
		expect(dto.htmlBody).toBeNull();
	});
});
