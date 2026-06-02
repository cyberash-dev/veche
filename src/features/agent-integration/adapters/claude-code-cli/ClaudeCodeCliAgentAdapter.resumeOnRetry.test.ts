// @covers agent-integration:BEH-007 @covers agent-integration:CTR-002
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asMeetingId, asParticipantId, asSessionId } from "../../../../shared/types/ids.js";
import { FakeClock } from "../../../../test-utils/FakeClock.js";
import { SilentLogger } from "../../../../test-utils/SilentLogger.js";
import { ClaudeCodeCliAgentAdapter } from "./ClaudeCodeCliAgentAdapter.js";

// A fake `claude` binary that reproduces the CLI's session-id uniqueness: a
// `--session-id X` invocation registers X on disk (the moment it runs), and a
// second `--session-id X` for the same X exits 1 with "already in use". A
// one-shot `fail_once` marker makes the FIRST registration exit 1 *after*
// registering — modelling a transient first-turn failure. `--resume X` always
// succeeds. The argv of every call is appended to `calls.log`.
const buildFakeClaude = async (): Promise<{ bin: string; state: string }> => {
	const state = await mkdtemp(join(tmpdir(), "veche-fake-claude-"));
	const bin = join(state, "claude");
	const script = `#!/usr/bin/env bash
state="${state}"
mkdir -p "$state/sessions"
printf '%s\\n' "$*" >> "$state/calls.log"
sid=""; mode=""; prev=""
for a in "$@"; do
  [ "$prev" = "--session-id" ] && { sid="$a"; mode="create"; }
  [ "$prev" = "--resume" ] && { sid="$a"; mode="resume"; }
  prev="$a"
done
if [ "$mode" = "create" ]; then
  if [ -e "$state/sessions/$sid" ]; then
    echo "Error: Session ID $sid is already in use." 1>&2
    exit 1
  fi
  : > "$state/sessions/$sid"
  if [ -e "$state/fail_once" ]; then
    rm -f "$state/fail_once"
    echo "boom: transient first-turn failure" 1>&2
    exit 1
  fi
  printf '{"type":"result","subtype":"success","is_error":false,"result":"FAKE_OK","session_id":"%s"}\\n' "$sid"
  exit 0
fi
if [ "$mode" = "resume" ]; then
  printf '{"type":"result","subtype":"success","is_error":false,"result":"FAKE_OK","session_id":"%s"}\\n' "$sid"
  exit 0
fi
echo "fake-claude: no session flag" 1>&2
exit 2
`;
	await writeFile(bin, script, "utf8");
	await chmod(bin, 0o755);
	await writeFile(join(state, "fail_once"), "", "utf8");
	return { bin, state };
};

const turn = (session: import("../../domain/Session.js").Session) => ({
	session,
	participantId: asParticipantId("reviewer"),
	prompt: "hi",
	transcriptPrefix: [],
	systemPrompt: null,
	workdir: null,
	model: null,
	extraFlags: [] as string[],
	env: {},
	roundNumber: 1,
	timeoutMs: 5_000,
	cancellationSignal: new AbortController().signal,
});

describe("ClaudeCodeCliAgentAdapter — retry after a failed first turn resumes the session", () => {
	it("re-attempts with --resume (not --session-id) so the retry does not collide with the created session", async () => {
		const { bin, state } = await buildFakeClaude();
		const adapter = new ClaudeCodeCliAgentAdapter(
			{ clock: new FakeClock(), logger: new SilentLogger() },
			{ bin },
		);
		const session = await adapter.openSession({
			meetingId: asMeetingId("m1"),
			participantId: asParticipantId("reviewer"),
			sessionId: asSessionId("00000000-0000-0000-0000-000000000003"),
			systemPrompt: null,
			workdir: null,
			model: null,
			extraFlags: [],
			env: {},
		});

		const first = await adapter.sendTurn(turn(session));
		const second = await adapter.sendTurn(turn(session));

		expect(first.kind).toBe("failure");
		expect(second.kind).toBe("speech");
		if (second.kind === "speech") {
			expect(second.text).toBe("FAKE_OK");
		}

		const calls = (await readFile(join(state, "calls.log"), "utf8"))
			.split("\n")
			.filter((line) => line.length > 0);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toContain("--session-id");
		expect(calls[1]).toContain("--resume");
		expect(calls[1]).not.toContain("--session-id");
	});
});
