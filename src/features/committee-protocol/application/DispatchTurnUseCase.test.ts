// @covers committee-protocol:BEH-001
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../../test-utils/FakeClock.js";
import { SilentLogger } from "../../../test-utils/SilentLogger.js";
import { FakeAgentAdapter } from "../../agent-integration/adapters/fake/FakeAgentAdapter.js";
import type { Session } from "../../agent-integration/domain/Session.js";
import {
	DEFAULT_MODEL_DISCUSSION_ROLE,
	type Participant,
} from "../../meeting/domain/Participant.js";
import { asMeetingId, asParticipantId, asSessionId } from "../../../shared/types/ids.js";
import { instantFromDate } from "../../../shared/types/instant.js";
import { PASS_PROTOCOL_REMINDER, PASS_PROTOCOL_SUFFIX } from "../domain/PassSignal.js";
import { DispatchTurnUseCase } from "./DispatchTurnUseCase.js";

const buildParticipant = (overrides: Partial<Participant> = {}): Participant => ({
	id: asParticipantId("alice"),
	role: "member",
	participantKind: "model",
	discussionRole: DEFAULT_MODEL_DISCUSSION_ROLE,
	isHumanParticipationEnabled: false,
	displayName: "Alice",
	adapter: "codex-cli",
	profile: null,
	systemPrompt: "You are Alice.",
	workdir: null,
	model: null,
	extraFlags: [],
	env: {},
	sessionId: asSessionId("sess-alice"),
	providerRef: null,
	status: "active",
	droppedAt: null,
	droppedReason: null,
	...overrides,
});

const buildSession = (providerRef: string | null): Session => ({
	id: asSessionId("sess-alice"),
	adapter: "codex-cli",
	participantId: asParticipantId("alice"),
	meetingId: asMeetingId("m-1"),
	providerRef,
	status: "open",
	openedAt: instantFromDate(new Date("2026-01-01T00:00:00.000Z")),
	closedAt: null,
});

describe("DispatchTurnUseCase prompt assembly", () => {
	it("prepends PASS_PROTOCOL_REMINDER on the per-Turn prompt of Round 1", async () => {
		const clock = new FakeClock();
		const adapter = new FakeAgentAdapter("codex-cli", clock);
		adapter.enqueue("alice", { kind: "pass" });
		const dispatch = new DispatchTurnUseCase({
			adapterFor: () => adapter,
			clock,
			logger: new SilentLogger(),
		});

		await dispatch.execute({
			session: buildSession(null),
			participant: buildParticipant(),
			transcriptPrefix: [],
			roundNumber: 1,
			timeoutMs: 1000,
			cancellationSignal: new AbortController().signal,
		});

		const sentPrompt = adapter.turns[0]!.turn.prompt;
		const [header, reminder] = sentPrompt.split("\n\n");
		expect(header).toMatch(/^\[meeting-round=1 self=alice/);
		expect(reminder).toBe(PASS_PROTOCOL_REMINDER);
		expect(PASS_PROTOCOL_REMINDER).toContain("<PASS/>");
		expect(PASS_PROTOCOL_REMINDER).not.toContain("\n");
	});

	it("prepends PASS_PROTOCOL_REMINDER on per-Turn prompts after Round 1 (resumed session)", async () => {
		const clock = new FakeClock();
		const adapter = new FakeAgentAdapter("codex-cli", clock);
		adapter.enqueue("alice", { kind: "pass" });
		const dispatch = new DispatchTurnUseCase({
			adapterFor: () => adapter,
			clock,
			logger: new SilentLogger(),
		});

		await dispatch.execute({
			session: buildSession("provider-ref-already-set"),
			participant: buildParticipant(),
			transcriptPrefix: [],
			roundNumber: 4,
			timeoutMs: 1000,
			cancellationSignal: new AbortController().signal,
		});

		const turn = adapter.turns[0]!.turn;
		expect(turn.systemPrompt).toBeNull();
		const lines = turn.prompt.split("\n\n");
		expect(lines[0]).toMatch(/^\[meeting-round=4 self=alice/);
		expect(lines[1]).toBe(PASS_PROTOCOL_REMINDER);
	});

	it("places PASS_PROTOCOL_SUFFIX before role block and base systemPrompt on Round 1", async () => {
		const clock = new FakeClock();
		const adapter = new FakeAgentAdapter("codex-cli", clock);
		adapter.enqueue("alice", { kind: "pass" });
		const dispatch = new DispatchTurnUseCase({
			adapterFor: () => adapter,
			clock,
			logger: new SilentLogger(),
		});

		await dispatch.execute({
			session: buildSession(null),
			participant: buildParticipant({ systemPrompt: "BASE_PROMPT_MARKER" }),
			transcriptPrefix: [],
			roundNumber: 1,
			timeoutMs: 1000,
			cancellationSignal: new AbortController().signal,
		});

		const sys = adapter.turns[0]!.turn.systemPrompt;
		expect(sys).not.toBeNull();
		const suffixIdx = sys!.indexOf(PASS_PROTOCOL_SUFFIX);
		const roleIdx = sys!.indexOf("Your discussion role is");
		const baseIdx = sys!.indexOf("BASE_PROMPT_MARKER");
		expect(suffixIdx).toBeGreaterThanOrEqual(0);
		expect(roleIdx).toBeGreaterThan(suffixIdx);
		expect(baseIdx).toBeGreaterThan(roleIdx);
	});
});
