// @covers agent-integration:CTR-002 @covers agent-integration:BEH-003
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asMeetingId, asParticipantId, asSessionId } from "../../../../shared/types/ids.js";
import { FakeClock } from "../../../../test-utils/FakeClock.js";
import { SilentLogger } from "../../../../test-utils/SilentLogger.js";
import { ClaudeCodeCliAgentAdapter } from "./ClaudeCodeCliAgentAdapter.js";

// Pointing `bin` at a directory passes `which` (X_OK is set on dirs for traversal)
// but fails `child_process.spawn` with EACCES on POSIX — a deterministic stand-in
// for a host sandbox blocking nested CLI spawn with EPERM on Windows.
const buildSpawnBlockedBin = async (): Promise<string> => {
	return await mkdtemp(join(tmpdir(), "veche-spawn-blocked-"));
};

describe("ClaudeCodeCliAgentAdapter — spawn blocked by host sandbox (EPERM/EACCES)", () => {
	it("returns failure with code 'claude-spawn-blocked', retryable=false, when the OS refuses to launch the binary", async () => {
		const bin = await buildSpawnBlockedBin();
		const adapter = new ClaudeCodeCliAgentAdapter(
			{ clock: new FakeClock(), logger: new SilentLogger() },
			{ bin },
		);
		const session = await adapter.openSession({
			meetingId: asMeetingId("m1"),
			participantId: asParticipantId("coder"),
			sessionId: asSessionId("00000000-0000-0000-0000-000000000002"),
			systemPrompt: null,
			workdir: null,
			model: null,
			extraFlags: [],
			env: {},
		});

		const result = await adapter.sendTurn({
			session,
			participantId: asParticipantId("coder"),
			prompt: "hi",
			transcriptPrefix: [],
			systemPrompt: null,
			workdir: null,
			model: null,
			extraFlags: [],
			env: {},
			roundNumber: 1,
			timeoutMs: 5_000,
			cancellationSignal: new AbortController().signal,
		});

		expect(result.kind).toBe("failure");
		if (result.kind !== "failure") {
			return;
		}
		expect(result.error?.code).toBe("claude-spawn-blocked");
		expect(result.error?.retryable).toBe(false);
		expect(result.error?.message).toMatch(/nested|host/i);
	});
});
