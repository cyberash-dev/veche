import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SilentLogger } from "../../../../test-utils/SilentLogger.js";
import { WatchServer } from "../WatchServer.js";
import { appendMember, seedMeeting } from "./fixtures.js";

interface Harness {
	readonly server: WatchServer;
	readonly url: string;
	readonly seed: Awaited<ReturnType<typeof seedMeeting>>;
}

let harness: Harness | null = null;

const requireHarness = (): Harness => {
	if (harness === null) {
		throw new Error("harness not set up");
	}
	return harness;
};

beforeEach(async () => {
	const seed = await seedMeeting();
	const server = new WatchServer(
		{ host: "127.0.0.1", port: 0, version: "test" },
		{ store: seed.store, clock: seed.clock, logger: new SilentLogger() },
	);
	const { url } = await server.start();
	harness = { server, url, seed };
});

afterEach(async () => {
	await harness?.server.stop();
	harness = null;
});

interface SseEvent {
	readonly event: string;
	readonly id: string | null;
	readonly data: unknown;
}

interface SseSubscription {
	readonly readUntil: (
		predicate: (events: readonly SseEvent[]) => boolean,
		opts?: { timeoutMs?: number },
	) => Promise<readonly SseEvent[]>;
	readonly close: () => Promise<void>;
}

const subscribeSse = (response: Response): SseSubscription => {
	if (response.body === null) {
		throw new Error("response has no body");
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const events: SseEvent[] = [];
	let buffer = "";
	const drainBlock = (block: string): void => {
		if (block.startsWith(":")) {
			return;
		}
		let event = "message";
		let id: string | null = null;
		let data = "";
		for (const line of block.split("\n")) {
			if (line.startsWith("event: ")) {
				event = line.slice(7).trim();
			} else if (line.startsWith("id: ")) {
				id = line.slice(4).trim();
			} else if (line.startsWith("data: ")) {
				data = line.slice(6);
			}
		}
		let parsed: unknown = null;
		if (data.length > 0) {
			try {
				parsed = JSON.parse(data.replace(/\\n/g, "\n"));
			} catch {
				parsed = data;
			}
		}
		events.push({ event, id, data: parsed });
	};

	const readUntil = async (
		predicate: (events: readonly SseEvent[]) => boolean,
		{ timeoutMs = 4000 }: { timeoutMs?: number } = {},
	): Promise<readonly SseEvent[]> => {
		if (predicate(events)) {
			return events.slice();
		}
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const remaining = deadline - Date.now();
			const timer = new Promise<{ value?: undefined; done?: undefined }>((resolve) =>
				setTimeout(() => resolve({}), Math.max(50, remaining)),
			);
			const next = await Promise.race([reader.read(), timer]);
			if ("done" in next && next.done) {
				break;
			}
			if ("value" in next && next.value) {
				buffer += decoder.decode(next.value, { stream: true });
				while (true) {
					const separatorIdx = buffer.indexOf("\n\n");
					if (separatorIdx < 0) {
						break;
					}
					const block = buffer.slice(0, separatorIdx);
					buffer = buffer.slice(separatorIdx + 2);
					drainBlock(block);
				}
				if (predicate(events)) {
					break;
				}
			}
		}
		return events.slice();
	};

	const close = async (): Promise<void> => {
		try {
			await reader.cancel();
		} catch {
			// ignore: cancellation may race with server-side close.
		}
	};

	return { readUntil, close };
};

describe("StreamApi /api/stream (meetings list)", () => {
	it("emits hello with the current snapshot", async () => {
		const res = await fetch(`${requireHarness().url}api/stream`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
		const sub = subscribeSse(res);
		const events = await sub.readUntil((es) => es.some((e) => e.event === "hello"));
		const hello = events.find((e) => e.event === "hello");
		if (hello === undefined) {
			throw new Error("expected hello event");
		}
		const data = hello.data as { summaries: { meetingId: string }[] };
		expect(data.summaries[0]?.meetingId).toBe(requireHarness().seed.meetingId);
		await sub.close();
	});
});

describe("StreamApi /api/stream/:id (transcript)", () => {
	it("emits hello with the seeded transcript", async () => {
		const res = await fetch(
			`${requireHarness().url}api/stream/${requireHarness().seed.meetingId}`,
		);
		expect(res.status).toBe(200);
		const sub = subscribeSse(res);
		const events = await sub.readUntil((es) => es.some((e) => e.event === "hello"));
		const hello = events.find((e) => e.event === "hello");
		if (hello === undefined) {
			throw new Error("expected hello event");
		}
		const data = hello.data as { messages: { id: string }[]; meeting: { id: string } };
		expect(data.meeting.id).toBe(requireHarness().seed.meetingId);
		expect(data.messages.length).toBeGreaterThan(0);
		await sub.close();
	});

	it("emits message.posted after a new message is appended", async () => {
		const res = await fetch(
			`${requireHarness().url}api/stream/${requireHarness().seed.meetingId}`,
		);
		const sub = subscribeSse(res);
		const helloEvents = await sub.readUntil((es) => es.some((e) => e.event === "hello"), {
			timeoutMs: 2000,
		});
		expect(helloEvents.some((e) => e.event === "hello")).toBe(true);

		await appendMember(
			requireHarness().seed.store,
			requireHarness().seed.meetingId,
			"bob",
			"live reply",
			1,
			"live-1",
		);

		const events = await sub.readUntil((es) => es.some((e) => e.event === "message.posted"), {
			timeoutMs: 5000,
		});
		const posted = events.find((e) => e.event === "message.posted");
		expect(posted).toBeDefined();
		const data = posted?.data as { message: { id: string; text: string } };
		expect(data.message.id).toBe("live-1");
		expect(data.message.text).toBe("live reply");
		await sub.close();
	});

	it("emits an error event for unknown meeting ids", async () => {
		const res = await fetch(`${requireHarness().url}api/stream/no-such-meeting`);
		const sub = subscribeSse(res);
		const events = await sub.readUntil((es) => es.some((e) => e.event === "error"));
		const errEvent = events.find((e) => e.event === "error");
		expect(errEvent).toBeDefined();
		const payload = errEvent?.data as { code: string };
		expect(payload.code).toBe("meeting-not-found");
		await sub.close();
	});
});
