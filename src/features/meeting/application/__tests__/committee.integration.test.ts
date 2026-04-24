import { describe, expect, it } from "vitest";
import { FakeClock } from "../../../../test-utils/FakeClock.js";
import { FakeIdGen } from "../../../../test-utils/FakeIdGen.js";
import { SilentLogger } from "../../../../test-utils/SilentLogger.js";
import { FakeAgentAdapter } from "../../../agent-integration/adapters/fake/FakeAgentAdapter.js";
import { ProfileResolver } from "../../../agent-integration/application/ProfileResolver.js";
import type { AgentAdapterPort } from "../../../agent-integration/ports/AgentAdapterPort.js";
import type { AgentAdapterRegistryPort } from "../../../agent-integration/ports/AgentAdapterRegistryPort.js";
import { DiscussionRunner } from "../../../committee-protocol/application/DiscussionRunner.js";
import { DispatchTurnUseCase } from "../../../committee-protocol/application/DispatchTurnUseCase.js";
import { HandleAgentFailureUseCase } from "../../../committee-protocol/application/HandleAgentFailureUseCase.js";
import { RunRoundUseCase } from "../../../committee-protocol/application/RunRoundUseCase.js";
import { TerminateDiscussionUseCase } from "../../../committee-protocol/application/TerminateDiscussionUseCase.js";
import { InMemoryMeetingStore } from "../../../persistence/adapters/in-memory/InMemoryMeetingStore.js";
import type { AdapterKind } from "../../domain/Participant.js";
import { CancelJobUseCase } from "../CancelJobUseCase.js";
import { GetResponseUseCase } from "../GetResponseUseCase.js";
import { JobRunner } from "../JobRunner.js";
import { SendMessageUseCase } from "../SendMessageUseCase.js";
import { StartMeetingUseCase } from "../StartMeetingUseCase.js";

const setup = () => {
	const clock = new FakeClock();
	const ids = new FakeIdGen();
	const logger = new SilentLogger();
	const store = new InMemoryMeetingStore(clock);
	const codex = new FakeAgentAdapter("codex-cli", clock);
	const claude = new FakeAgentAdapter("claude-code-cli", clock);
	const registry: AgentAdapterRegistryPort = {
		get(kind: AdapterKind): AgentAdapterPort {
			if (kind === "codex-cli") {
				return codex;
			}
			if (kind === "claude-code-cli") {
				return claude;
			}
			throw new Error(`unknown adapter ${kind}`);
		},
	};
	const profileResolver = new ProfileResolver(null);
	const dispatch = new DispatchTurnUseCase({
		adapterFor: (pid) => registry.get(pid === "reviewer" ? "claude-code-cli" : "codex-cli"),
		clock,
		logger,
		sleep: async () => {},
	});
	const handleFailure = new HandleAgentFailureUseCase({
		store,
		clock,
		ids,
		logger,
		adapterFor: (pid) => registry.get(pid === "reviewer" ? "claude-code-cli" : "codex-cli"),
	});
	const terminate = new TerminateDiscussionUseCase({ store, clock });
	const runRound = new RunRoundUseCase({
		store,
		clock,
		ids,
		logger,
		adapterFor: (pid) => registry.get(pid === "reviewer" ? "claude-code-cli" : "codex-cli"),
		dispatch,
		handleFailure,
	});
	const discussion = new DiscussionRunner({ store, clock, logger, runRound, terminate });
	const jobRunner = new JobRunner({ runner: discussion, logger });

	const start = new StartMeetingUseCase({
		store,
		clock,
		ids,
		logger,
		adapters: registry,
		profileResolver,
		maxRoundsCap: 16,
	});
	const send = new SendMessageUseCase({
		store,
		clock,
		ids,
		logger,
		jobRunner,
		maxRoundsCap: 16,
	});
	const getResponse = new GetResponseUseCase({ store });
	const cancelJob = new CancelJobUseCase({ store, clock, jobRunner });
	return { store, clock, ids, codex, claude, jobRunner, start, send, getResponse, cancelJob };
};

const waitForJob = async (
	getResponse: GetResponseUseCase,
	jobId: ReturnType<FakeIdGen["newJobId"]>,
): Promise<Awaited<ReturnType<GetResponseUseCase["execute"]>>> => {
	let cursor: string | undefined;
	const accumulated: Array<
		Awaited<ReturnType<GetResponseUseCase["execute"]>>["messages"][number]
	> = [];
	let last: Awaited<ReturnType<GetResponseUseCase["execute"]>> | null = null;
	for (let i = 0; i < 50; i++) {
		const res = await getResponse.execute({
			jobId,
			...(cursor !== undefined ? { cursor } : {}),
			limit: 500,
		});
		last = res;
		accumulated.push(...res.messages);
		cursor = res.nextCursor;
		if (res.status === "completed" || res.status === "failed" || res.status === "cancelled") {
			// drain any remaining pages
			while (true) {
				const drain = await getResponse.execute({ jobId, cursor, limit: 500 });
				if (drain.messages.length === 0) {
					break;
				}
				accumulated.push(...drain.messages);
				cursor = drain.nextCursor;
				if (!drain.hasMore) {
					break;
				}
			}
			return { ...res, messages: accumulated };
		}
		await new Promise((r) => setTimeout(r, 5));
	}
	if (last) {
		return { ...last, messages: accumulated };
	}
	throw new Error("job did not terminate");
};

describe("committee integration", () => {
	it("runs a meeting to all-passed termination", async () => {
		const t = setup();
		const started = await t.start.execute({
			title: "Test committee",
			facilitator: { id: "claude" },
			members: [
				{ id: "coder", adapter: "codex-cli" },
				{ id: "reviewer", adapter: "claude-code-cli" },
			],
			defaultMaxRounds: 5,
		});
		expect(started.participants).toHaveLength(3);

		// Round 1: both speak; Round 2: both pass → terminates.
		t.codex.enqueue("coder", [{ kind: "speech", text: "I propose X" }, { kind: "pass" }]);
		t.claude.enqueue("reviewer", [
			{ kind: "speech", text: "I counter with Y" },
			{ kind: "pass" },
		]);

		const sent = await t.send.execute({
			meetingId: started.meetingId,
			text: "Decide X vs Y",
		});
		const final = await waitForJob(t.getResponse, sent.jobId);
		expect(final.status).toBe("completed");
		expect(final.terminationReason).toBe("all-passed");
		// facilitator + 2 speeches + 2 passes = 5 messages
		const speechOrPass = final.messages.filter((m) => m.kind !== "system");
		expect(speechOrPass).toHaveLength(5);
		const facilitatorMsg = final.messages.find((m) => m.round === 0);
		expect(facilitatorMsg?.text).toBe("Decide X vs Y");

		// Bounded-delta invariant: in Round 2, each member's prompt prefix contains ONLY the
		// other member's Round 1 speech — the facilitator's opening Message is already in the
		// member's provider session from Round 1 and must not be re-sent. The member's own
		// Round 1 speech is also excluded. Per
		// spec/features/committee-protocol/run-round.usecase.md step 4a.
		const coderRound2 = t.codex.turns.find(
			(x) => x.turn.participantId === "coder" && x.turn.roundNumber === 2,
		);
		const reviewerRound2 = t.claude.turns.find(
			(x) => x.turn.participantId === "reviewer" && x.turn.roundNumber === 2,
		);
		expect(coderRound2).toBeDefined();
		expect(reviewerRound2).toBeDefined();
		const coderPrefix = coderRound2?.turn.transcriptPrefix ?? [];
		const reviewerPrefix = reviewerRound2?.turn.transcriptPrefix ?? [];
		expect(coderPrefix).toHaveLength(1);
		expect(reviewerPrefix).toHaveLength(1);
		// The single prefix entry is the OTHER member's R1 speech.
		expect(coderPrefix[0]?.authorId).toBe("reviewer");
		expect(coderPrefix[0]?.round).toBe(1);
		expect(reviewerPrefix[0]?.authorId).toBe("coder");
		expect(reviewerPrefix[0]?.round).toBe(1);
		// Round 1 prefix, by contrast, contained only the facilitator Message.
		const coderRound1 = t.codex.turns.find(
			(x) => x.turn.participantId === "coder" && x.turn.roundNumber === 1,
		);
		expect(coderRound1?.turn.transcriptPrefix).toHaveLength(1);
		expect(coderRound1?.turn.transcriptPrefix[0]?.authorRole).toBe("facilitator");
	});

	it("drops a member that fails fatally and continues", async () => {
		const t = setup();
		const started = await t.start.execute({
			title: "Fault tolerance",
			facilitator: { id: "claude" },
			members: [
				{ id: "coder", adapter: "codex-cli" },
				{ id: "reviewer", adapter: "claude-code-cli" },
			],
			defaultMaxRounds: 3,
		});
		// coder fatally fails → dropped; reviewer speaks once then passes → all-passed on round 2.
		t.codex.enqueue("coder", [
			{ kind: "failure", code: "AdapterParseError", message: "bad output", retryable: false },
		]);
		t.claude.enqueue("reviewer", [
			{ kind: "speech", text: "I will decide alone" },
			{ kind: "pass" },
		]);

		const sent = await t.send.execute({
			meetingId: started.meetingId,
			text: "Please decide.",
		});
		const final = await waitForJob(t.getResponse, sent.jobId);
		expect(final.status).toBe("completed");
		expect(final.terminationReason).toBe("all-passed");
		const systemDrop = final.messages.find(
			(m) => m.kind === "system" && m.text.includes("coder"),
		);
		expect(systemDrop).toBeDefined();
	});

	it("terminates at max_rounds when members never pass", async () => {
		const t = setup();
		const started = await t.start.execute({
			title: "Runaway",
			facilitator: { id: "claude" },
			members: [{ id: "coder", adapter: "codex-cli" }],
			defaultMaxRounds: 3,
		});
		t.codex.enqueue("coder", [
			{ kind: "speech", text: "r1" },
			{ kind: "speech", text: "r2" },
			{ kind: "speech", text: "r3" },
		]);

		const sent = await t.send.execute({
			meetingId: started.meetingId,
			text: "go",
			maxRounds: 3,
		});
		const final = await waitForJob(t.getResponse, sent.jobId);
		expect(final.status).toBe("completed");
		expect(final.terminationReason).toBe("max-rounds");
	});

	it("cancels an in-flight job and finalises the transcript", async () => {
		const t = setup();
		const started = await t.start.execute({
			title: "Cancel me",
			facilitator: { id: "claude" },
			members: [{ id: "coder", adapter: "codex-cli" }],
			defaultMaxRounds: 16,
		});
		// Long queue with delays so the loop does not finish before we cancel
		for (let i = 0; i < 20; i++) {
			t.codex.enqueue("coder", { kind: "speech", text: `reply ${i}`, delayMs: 50 });
		}
		const sent = await t.send.execute({
			meetingId: started.meetingId,
			text: "go",
			maxRounds: 16,
		});
		// Let at least the first round start
		await new Promise((r) => setTimeout(r, 30));
		const cancelled = await t.cancelJob.execute({ jobId: sent.jobId, reason: "user-abort" });
		expect(cancelled.status).toBe("cancelled");
		const final = await waitForJob(t.getResponse, sent.jobId);
		expect(final.status).toBe("cancelled");
	});
});
