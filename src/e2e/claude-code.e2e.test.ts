import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ClaudeCodeCliAgentAdapter } from "../features/agent-integration/adapters/claude-code-cli/ClaudeCodeCliAgentAdapter.js";
import { asMeetingId, asParticipantId, asSessionId } from "../shared/types/ids.js";
import { FakeClock } from "../test-utils/FakeClock.js";
import { SilentLogger } from "../test-utils/SilentLogger.js";

const runE2e = process.env.AI_MEETING_E2E === "1";
const d = runE2e ? describe : describe.skip;

d("claude-code e2e (opt-in AI_MEETING_E2E=1)", () => {
	it("openSession + sendTurn returns speech", async () => {
		const clock = new FakeClock();
		const adapter = new ClaudeCodeCliAgentAdapter(
			{ clock, logger: new SilentLogger() },
			{ defaultDisallowedTools: ["Bash", "Edit", "Write", "NotebookEdit"] },
		);
		const sessionId = asSessionId(randomUUID());
		const session = await adapter.openSession({
			meetingId: asMeetingId("e2e-meeting"),
			participantId: asParticipantId("reviewer"),
			sessionId,
			systemPrompt: "Answer in a single short sentence.",
			workdir: null,
			model: null,
			extraFlags: [],
			env: {},
		});
		try {
			const result = await adapter.sendTurn({
				session,
				participantId: asParticipantId("reviewer"),
				prompt: "Name one programming language. One word only.",
				transcriptPrefix: [],
				systemPrompt: "Answer in a single short sentence.",
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
				expect(result.text.length).toBeLessThan(500);
			}
			expect(result.providerRef).toBe(sessionId);
		} finally {
			await adapter.closeSession(session);
		}
	}, 180_000);
});
