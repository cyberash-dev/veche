// @covers agent-integration:CTR-001 @covers agent-integration:BEH-003
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asMeetingId, asParticipantId, asSessionId } from "../../../../shared/types/ids.js";
import { FakeClock } from "../../../../test-utils/FakeClock.js";
import { SilentLogger } from "../../../../test-utils/SilentLogger.js";
import { CodexCliAgentAdapter } from "./CodexCliAgentAdapter.js";

// Pointing `bin` at a directory passes `which` (X_OK is set on dirs for traversal)
// but fails `child_process.spawn` with EACCES on POSIX — a deterministic stand-in
// for the Codex-host sandbox blocking nested codex spawn with EPERM on Windows.
const buildSpawnBlockedBin = async (): Promise<string> => {
	return await mkdtemp(join(tmpdir(), "veche-spawn-blocked-"));
};

describe("CodexCliAgentAdapter — spawn blocked by host sandbox (EPERM/EACCES)", () => {
	it("returns failure with code 'codex-spawn-blocked', retryable=false, when the OS refuses to launch the binary", async () => {
		const bin = await buildSpawnBlockedBin();
		const adapter = new CodexCliAgentAdapter(
			{ clock: new FakeClock(), logger: new SilentLogger() },
			{ bin },
		);
		const session = await adapter.openSession({
			meetingId: asMeetingId("m1"),
			participantId: asParticipantId("coder"),
			sessionId: asSessionId("00000000-0000-0000-0000-000000000001"),
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
		expect(result.error?.code).toBe("codex-spawn-blocked");
		expect(result.error?.retryable).toBe(false);
		expect(result.error?.message).toMatch(/nested|host|Codex/i);
	});
});
