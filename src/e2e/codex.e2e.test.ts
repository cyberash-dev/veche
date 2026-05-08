// @covers agent-integration:BEH-001 @covers agent-integration:BEH-002
// @covers agent-integration:BEH-003 @covers agent-integration:BEH-004
// @covers agent-integration:BEH-005 @covers agent-integration:BEH-006
// @covers agent-integration:BEH-007 @covers agent-integration:BEH-008
// @covers agent-integration:CTR-001 @covers agent-integration:CTR-002
// @covers agent-integration:CTR-003 @covers agent-integration:CTR-004
// @covers agent-integration:INV-001 @covers agent-integration:INV-002
// @covers agent-integration:INV-003 @covers agent-integration:INV-004
// @covers agent-integration:INV-005 @covers agent-integration:EXT-001
// @covers agent-integration:EXT-002 @covers agent-integration:POL-001
// @covers agent-integration:POL-002 @covers agent-integration:CST-001
// @covers agent-integration:CST-002
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CodexCliAgentAdapter } from "../features/agent-integration/adapters/codex-cli/CodexCliAgentAdapter.js";
import { asMeetingId, asParticipantId, asSessionId } from "../shared/types/ids.js";
import { FakeClock } from "../test-utils/FakeClock.js";
import { SilentLogger } from "../test-utils/SilentLogger.js";

const runE2e = process.env.VECHE_E2E === "1";
const d = runE2e ? describe : describe.skip;

d("codex e2e (opt-in VECHE_E2E=1)", () => {
	it("openSession + sendTurn returns speech and captures thread_id", async () => {
		const clock = new FakeClock();
		const adapter = new CodexCliAgentAdapter({ clock, logger: new SilentLogger() });
		const sessionId = asSessionId(randomUUID());
		const session = await adapter.openSession({
			meetingId: asMeetingId("e2e-meeting"),
			participantId: asParticipantId("coder"),
			sessionId,
			systemPrompt: "Answer in one word.",
			workdir: null,
			model: null,
			extraFlags: [],
			env: {},
		});
		try {
			const result = await adapter.sendTurn({
				session,
				participantId: asParticipantId("coder"),
				prompt: "Name one programming language. One word.",
				transcriptPrefix: [],
				systemPrompt: "Answer in one word.",
				workdir: null,
				model: null,
				extraFlags: [],
				env: {},
				roundNumber: 1,
				timeoutMs: 120_000,
				cancellationSignal: new AbortController().signal,
			});
			expect(result.kind).toBe("speech");
			if (result.kind === "speech") {
				expect(result.text.length).toBeGreaterThan(0);
				expect(result.text.length).toBeLessThan(1000);
			}
			// Codex emits thread.started on turn 1 → providerRef should be populated.
			expect(result.providerRef).toBeTruthy();
		} finally {
			await adapter.closeSession(session);
		}
	}, 180_000);
});
