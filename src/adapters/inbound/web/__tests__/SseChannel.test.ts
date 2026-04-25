import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { SseChannel } from "../SseChannel.js";

interface FakeResponse {
	readonly response: ServerResponse;
	readonly written: () => string;
	readonly headersWritten: () => Array<{ status: number; headers: Record<string, string> }>;
	readonly ended: () => boolean;
}

const fakeResponse = (): FakeResponse => {
	const buffers: string[] = [];
	const headers: Array<{ status: number; headers: Record<string, string> }> = [];
	let ended = false;
	const stub = {
		writeHead(status: number, hdrs: Record<string, string>): unknown {
			headers.push({ status, headers: hdrs });
			return stub;
		},
		write(chunk: string | Buffer): boolean {
			buffers.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
			return true;
		},
		end(): unknown {
			ended = true;
			return stub;
		},
	};
	return {
		response: stub as unknown as ServerResponse,
		written: () => buffers.join(""),
		headersWritten: () => headers,
		ended: () => ended,
	};
};

describe("SseChannel", () => {
	it("sets SSE headers on writeHeaders()", () => {
		const fake = fakeResponse();
		const channel = new SseChannel(fake.response);
		channel.writeHeaders();
		expect(fake.headersWritten()).toHaveLength(1);
		const [written] = fake.headersWritten();
		if (written === undefined) {
			throw new Error("headers not written");
		}
		expect(written.status).toBe(200);
		expect(written.headers["Content-Type"]).toBe("text/event-stream; charset=utf-8");
		expect(written.headers["Cache-Control"]).toBe("no-cache, no-transform");
		expect(written.headers["X-Accel-Buffering"]).toBe("no");
		expect(fake.written().startsWith(":ok\n\n")).toBe(true);
	});

	it("writes event/id/data lines in order", () => {
		const fake = fakeResponse();
		const channel = new SseChannel(fake.response);
		channel.writeHeaders();
		channel.writeEvent("hello", { greeting: "hi" }, "42");
		const text = fake.written();
		const eventIdx = text.indexOf("event: hello");
		const idIdx = text.indexOf("id: 42");
		const dataIdx = text.indexOf("data:");
		expect(eventIdx).toBeGreaterThan(-1);
		expect(idIdx).toBeGreaterThan(eventIdx);
		expect(dataIdx).toBeGreaterThan(idIdx);
		expect(text).toContain('data: {"greeting":"hi"}');
	});

	it("omits id: line when no event id is given", () => {
		const fake = fakeResponse();
		const channel = new SseChannel(fake.response);
		channel.writeHeaders();
		channel.writeEvent("ping", { ok: true });
		expect(fake.written()).not.toContain("id: ");
	});

	it("escapes newlines in data payload", () => {
		const fake = fakeResponse();
		const channel = new SseChannel(fake.response);
		channel.writeHeaders();
		channel.writeEvent("payload", { text: "line1\nline2" });
		const text = fake.written();
		expect(text).toContain("\\n");
		expect(text).not.toMatch(/data: \{[^\n]*line1\n[^\n]*line2/);
	});

	it("writes a comment line for keepalives", () => {
		const fake = fakeResponse();
		const channel = new SseChannel(fake.response);
		channel.writeHeaders();
		channel.writeKeepalive();
		expect(fake.written()).toContain(":keepalive\n\n");
	});

	it("ignores writes after close", () => {
		const fake = fakeResponse();
		const channel = new SseChannel(fake.response);
		channel.writeHeaders();
		channel.close();
		channel.writeEvent("foo", { x: 1 });
		channel.writeKeepalive();
		expect(fake.written()).not.toContain("event: foo");
		expect(fake.ended()).toBe(true);
	});
});
