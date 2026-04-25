import { request as httpRequest } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SilentLogger } from "../../../../test-utils/SilentLogger.js";
import { WatchServer } from "../WatchServer.js";
import { appendMember, seedMeeting } from "./fixtures.js";

const requestRaw = (
	host: string,
	port: number,
	path: string,
	headers: Record<string, string>,
): Promise<{ status: number; body: string }> =>
	new Promise((resolve, reject) => {
		const req = httpRequest({ host, port, path, method: "GET", headers }, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (chunk: string) => {
				body += chunk;
			});
			res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
		});
		req.on("error", reject);
		req.end();
	});

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

const startHarness = async (): Promise<Harness> => {
	const seed = await seedMeeting();
	const server = new WatchServer(
		{ host: "127.0.0.1", port: 0, version: "test" },
		{ store: seed.store, clock: seed.clock, logger: new SilentLogger() },
	);
	const { url } = await server.start();
	return { server, url, seed };
};

beforeEach(async () => {
	harness = await startHarness();
});

afterEach(async () => {
	await harness?.server.stop();
	harness = null;
});

describe("WatchServer routes", () => {
	it("GET / returns the SPA", async () => {
		const res = await fetch(`${requireHarness().url}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/^text\/html/);
		const body = await res.text();
		expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
		expect(body).toContain("veche · live");
	});

	it("GET /api/meetings returns the seeded summary", async () => {
		const res = await fetch(`${requireHarness().url}api/meetings`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { summaries: { meetingId: string }[] };
		expect(body.summaries).toHaveLength(1);
		expect(body.summaries[0]?.meetingId).toBe(requireHarness().seed.meetingId);
	});

	it("GET /api/meetings/:id returns the snapshot", async () => {
		const res = await fetch(
			`${requireHarness().url}api/meetings/${requireHarness().seed.meetingId}`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { meeting: { id: string }; lastSeq: number };
		expect(body.meeting.id).toBe(requireHarness().seed.meetingId);
		expect(body.lastSeq).toBeGreaterThanOrEqual(0);
	});

	it("GET /api/meetings/:id returns 404 for unknown ids", async () => {
		const res = await fetch(`${requireHarness().url}api/meetings/does-not-exist`);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("meeting not found");
	});

	it("GET /api/meetings/:id/messages returns the transcript page", async () => {
		await appendMember(
			requireHarness().seed.store,
			requireHarness().seed.meetingId,
			"bob",
			"reply",
			1,
			"reply-1",
		);
		const res = await fetch(
			`${requireHarness().url}api/meetings/${requireHarness().seed.meetingId}/messages?limit=50`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			messages: { id: string; text: string }[];
			hasMore: boolean;
		};
		expect(body.messages.map((m) => m.id)).toContain("reply-1");
		expect(body.hasMore).toBe(false);
	});

	it("returns 404 for unknown paths", async () => {
		const res = await fetch(`${requireHarness().url}nope`);
		expect(res.status).toBe(404);
	});

	it("rejects requests whose Host header does not match loopback", async () => {
		const url = new URL(requireHarness().url);
		const port = Number(url.port);
		const res = await requestRaw("127.0.0.1", port, "/api/meetings", {
			Host: "evil.example.com",
		});
		expect(res.status).toBe(421);
	});

	it("stop() shuts the listener down", async () => {
		await harness?.server.stop();
		const url = requireHarness().url;
		harness = null;
		await expect(fetch(url)).rejects.toBeTruthy();
	});
});
