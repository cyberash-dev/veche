import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Meeting } from "../../../../features/meeting/domain/Meeting.js";
import type { Participant } from "../../../../features/meeting/domain/Participant.js";
import { FileMeetingStore } from "../../../../features/persistence/adapters/file/FileMeetingStore.js";
import {
	asMeetingId,
	asMessageId,
	asParticipantId,
	asSessionId,
} from "../../../../shared/types/ids.js";
import { asInstant } from "../../../../shared/types/instant.js";
import { FakeClock } from "../../../../test-utils/FakeClock.js";
import { SilentLogger } from "../../../../test-utils/SilentLogger.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(dirname, "../../../../../dist/bin/veche.js");

interface CliResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

const runCliBin = (args: readonly string[], env: NodeJS.ProcessEnv): Promise<CliResult> =>
	new Promise((resolve) => {
		const child = spawn(process.execPath, [binPath, ...args], {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (c: string) => {
			stdout += c;
		});
		child.stderr.on("data", (c: string) => {
			stderr += c;
		});
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});

const seedMeeting = async (root: string): Promise<string> => {
	const clock = new FakeClock();
	const logger = new SilentLogger();
	const store = new FileMeetingStore({ clock, logger }, { rootDir: root });
	const id = asMeetingId("cli-test-1");
	const meeting: Meeting = {
		id,
		title: "Seeded meeting",
		status: "active",
		createdAt: clock.now(),
		endedAt: null,
		participants: [],
		defaultMaxRounds: 3,
	};
	const facilitator: Participant = {
		id: asParticipantId("claude"),
		role: "facilitator",
		displayName: "claude",
		adapter: null,
		profile: null,
		systemPrompt: null,
		workdir: null,
		model: null,
		extraFlags: [],
		env: {},
		sessionId: null,
		providerRef: null,
		status: "active",
		droppedAt: null,
		droppedReason: null,
	};
	const coder: Participant = {
		...facilitator,
		id: asParticipantId("coder"),
		role: "member",
		displayName: "coder",
		adapter: "codex-cli",
		sessionId: asSessionId("00000000-0000-4000-8000-000000000001"),
	};
	await store.createMeeting({ meeting, participants: [facilitator, coder] });
	await store.appendMessage({
		meetingId: id,
		jobId: null,
		message: {
			id: asMessageId("m-1"),
			round: 0,
			author: asParticipantId("claude"),
			kind: "speech",
			text: "What should we call this thing?",
			createdAt: asInstant("2026-04-24T10:00:00.000Z"),
		},
	});
	await store.appendMessage({
		meetingId: id,
		jobId: null,
		message: {
			id: asMessageId("m-2"),
			round: 1,
			author: asParticipantId("coder"),
			kind: "speech",
			text: "veche",
			createdAt: asInstant("2026-04-24T10:00:01.000Z"),
		},
	});
	return id;
};

describe("veche CLI (integration)", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "veche-cli-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("list --format json returns the seeded meeting", async () => {
		const id = await seedMeeting(root);
		const res = await runCliBin(["list", "--format", "json", "--home", root], {
			...process.env,
			NO_COLOR: "1",
			VECHE_STORE: "file",
		});
		expect(res.code).toBe(0);
		const parsed = JSON.parse(res.stdout);
		expect(parsed.summaries).toHaveLength(1);
		expect(parsed.summaries[0].meetingId).toBe(id);
	});

	it("show <id> --format json returns the full transcript", async () => {
		const id = await seedMeeting(root);
		const res = await runCliBin(["show", id, "--format", "json", "--home", root], {
			...process.env,
			NO_COLOR: "1",
		});
		expect(res.code).toBe(0);
		const parsed = JSON.parse(res.stdout);
		expect(parsed.meeting.id).toBe(id);
		expect(parsed.messages).toHaveLength(2);
		expect(parsed.messages[0].text).toContain("What should we call");
	});

	it("show <id> --format html writes a self-contained file with --out", async () => {
		const id = await seedMeeting(root);
		const htmlPath = path.join(root, "out.html");
		const res = await runCliBin(
			["show", id, "--format", "html", "--out", htmlPath, "--home", root],
			{ ...process.env, NO_COLOR: "1" },
		);
		expect(res.code).toBe(0);
		const html = await (await import("node:fs/promises")).readFile(htmlPath, "utf8");
		expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
		expect(html).toContain("Seeded meeting");
		expect(html).not.toMatch(/<script[\s>]/);
		expect(html).not.toMatch(/src="https?:/);
	});

	it("show unknown meeting returns exit code 3", async () => {
		await seedMeeting(root);
		const res = await runCliBin(
			["show", "does-not-exist", "--format", "json", "--home", root],
			{ ...process.env, NO_COLOR: "1" },
		);
		expect(res.code).toBe(3);
		expect(res.stderr).toContain("not found");
	});

	it("usage error on bad flag returns 64", async () => {
		const res = await runCliBin(["show"], {
			...process.env,
			NO_COLOR: "1",
			VECHE_HOME: root,
		});
		expect(res.code).toBe(64);
	});

	it("watch --help prints usage and exits 0", async () => {
		const res = await runCliBin(["watch", "--help"], {
			...process.env,
			NO_COLOR: "1",
			VECHE_HOME: root,
		});
		expect(res.code).toBe(0);
		expect(res.stderr).toContain("watch");
		expect(res.stderr).toContain("--port");
	});

	it("watch with bad --port returns 64", async () => {
		const res = await runCliBin(["watch", "--port", "999999", "--no-open", "--home", root], {
			...process.env,
			NO_COLOR: "1",
		});
		expect(res.code).toBe(64);
		expect(res.stderr).toContain("--port");
	});

	it("install --help prints usage and exits 0", async () => {
		const res = await runCliBin(["install", "--help"], {
			...process.env,
			NO_COLOR: "1",
			VECHE_HOME: root,
		});
		expect(res.code).toBe(0);
		expect(res.stderr).toContain("install");
		expect(res.stderr).toContain("--for");
	});

	it("install --dry-run does not write files or spawn host CLIs", async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "veche-install-"));
		try {
			const res = await runCliBin(["install", "--dry-run", "--home", root], {
				...process.env,
				NO_COLOR: "1",
				HOME: home,
				CLAUDE_BIN: "/nonexistent/claude",
				CODEX_BIN: "/nonexistent/codex",
			});
			expect(res.code).toBe(0);
			expect(res.stderr).toContain("(dry-run)");
			expect(res.stderr).toContain("[claude-code]");
			expect(res.stderr).toContain("[codex]");
			await expect(
				(await import("node:fs/promises")).access(
					path.join(home, ".claude", "skills", "veche", "SKILL.md"),
				),
			).rejects.toBeTruthy();
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("install with both --skills-only and --mcp-only returns 64", async () => {
		const res = await runCliBin(["install", "--skills-only", "--mcp-only", "--home", root], {
			...process.env,
			NO_COLOR: "1",
		});
		expect(res.code).toBe(64);
		expect(res.stderr).toContain("mutually exclusive");
	});

	it("watch starts a server, accepts SIGINT, and exits 0", async () => {
		await seedMeeting(root);
		const child = spawn(
			process.execPath,
			[binPath, "watch", "--port", "0", "--no-open", "--home", root],
			{
				env: { ...process.env, NO_COLOR: "1" },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		const listening = await new Promise<{ url: string }>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error("timed out waiting for listener")),
				5000,
			);
			const onData = (chunk: string): void => {
				const match = chunk.match(/listening on (http:\/\/[^\s]+)/);
				if (match) {
					clearTimeout(timer);
					child.stderr.off("data", onData);
					resolve({ url: match[1]! });
				}
			};
			child.stderr.on("data", onData);
		});

		const res = await fetch(`${listening.url}api/meetings`);
		expect(res.status).toBe(200);

		child.kill("SIGINT");
		const code = await new Promise<number>((resolve) => {
			child.on("close", (c) => resolve(c ?? 1));
		});
		expect(code).toBe(0);
		expect(stderr).toContain("listening on");
		expect(stderr).toContain("bye");
	});
});
