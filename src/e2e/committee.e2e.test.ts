import { describe, expect, it } from "vitest";
import { VecheMcpServer } from "../adapters/inbound/mcp/VecheMcpServer.js";
import { ClaudeCodeCliAgentAdapter } from "../features/agent-integration/adapters/claude-code-cli/ClaudeCodeCliAgentAdapter.js";
import { CodexCliAgentAdapter } from "../features/agent-integration/adapters/codex-cli/CodexCliAgentAdapter.js";
import { ProfileResolver } from "../features/agent-integration/application/ProfileResolver.js";
import type { AgentAdapterPort } from "../features/agent-integration/ports/AgentAdapterPort.js";
import type { AgentAdapterRegistryPort } from "../features/agent-integration/ports/AgentAdapterRegistryPort.js";
import { DiscussionRunner } from "../features/committee-protocol/application/DiscussionRunner.js";
import { DispatchTurnUseCase } from "../features/committee-protocol/application/DispatchTurnUseCase.js";
import { HandleAgentFailureUseCase } from "../features/committee-protocol/application/HandleAgentFailureUseCase.js";
import { RunRoundUseCase } from "../features/committee-protocol/application/RunRoundUseCase.js";
import { TerminateDiscussionUseCase } from "../features/committee-protocol/application/TerminateDiscussionUseCase.js";
import {
	CancelJobUseCase,
	EndMeetingUseCase,
	GetResponseUseCase,
	GetTranscriptUseCase,
	JobRunner,
	ListMeetingsUseCase,
	SendMessageUseCase,
	StartMeetingUseCase,
} from "../features/meeting/index.js";
import { InMemoryMeetingStore } from "../features/persistence/adapters/in-memory/InMemoryMeetingStore.js";
import { SystemClock } from "../infra/SystemClock.js";
import { UuidIdGen } from "../infra/UuidIdGen.js";
import type { ParticipantId } from "../shared/types/ids.js";
import { SilentLogger } from "../test-utils/SilentLogger.js";

const runE2e = process.env.VECHE_E2E === "1";
const d = runE2e ? describe : describe.skip;

const setup = () => {
	const clock = new SystemClock();
	const ids = new UuidIdGen();
	const logger = new SilentLogger();
	const store = new InMemoryMeetingStore(clock);
	const codex = new CodexCliAgentAdapter({ clock, logger });
	const claude = new ClaudeCodeCliAgentAdapter({ clock, logger });
	const registry: AgentAdapterRegistryPort = {
		get(kind): AgentAdapterPort {
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

	const adapterByParticipant = new Map<ParticipantId, AgentAdapterPort>();
	const adapterFor = (pid: ParticipantId): AgentAdapterPort => {
		const found = adapterByParticipant.get(pid);
		if (found) {
			return found;
		}
		throw new Error(`No adapter for ${pid}`);
	};

	const dispatch = new DispatchTurnUseCase({ adapterFor, clock, logger });
	const handleFailure = new HandleAgentFailureUseCase({
		store,
		clock,
		ids,
		logger,
		adapterFor,
	});
	const terminate = new TerminateDiscussionUseCase({ store, clock });
	const runRound = new RunRoundUseCase({
		store,
		clock,
		ids,
		logger,
		adapterFor,
		dispatch,
		handleFailure,
	});
	const discussion = new DiscussionRunner({ store, clock, logger, runRound, terminate });
	const instrumented = {
		async run(input: Parameters<DiscussionRunner["run"]>[0]): Promise<void> {
			const snap = await store.loadMeeting(input.meetingId);
			for (const p of snap.participants) {
				if (p.role === "member" && p.adapter) {
					adapterByParticipant.set(p.id, registry.get(p.adapter));
				}
			}
			return discussion.run(input);
		},
	} as DiscussionRunner;
	const jobRunner = new JobRunner({ runner: instrumented, logger });

	const startMeeting = new StartMeetingUseCase({
		store,
		clock,
		ids,
		logger,
		adapters: registry,
		profileResolver,
		maxRoundsCap: 16,
	});
	const sendMessage = new SendMessageUseCase({
		store,
		clock,
		ids,
		logger,
		jobRunner,
		maxRoundsCap: 16,
	});
	const getResponse = new GetResponseUseCase({ store });
	const listMeetings = new ListMeetingsUseCase({ store });
	const getTranscript = new GetTranscriptUseCase({ store });
	const cancelJob = new CancelJobUseCase({ store, clock, jobRunner });
	const endMeeting = new EndMeetingUseCase({
		store,
		clock,
		logger,
		adapters: registry,
		cancelJob,
	});

	const mcp = new VecheMcpServer({
		logger,
		startMeeting,
		sendMessage,
		getResponse,
		listMeetings,
		getTranscript,
		endMeeting,
		cancelJob,
	});

	return { startMeeting, sendMessage, getResponse, endMeeting, jobRunner, mcp };
};

d("committee e2e (opt-in VECHE_E2E=1)", () => {
	it("Claude + Codex reach consensus via <PASS/>", async () => {
		const t = setup();

		const started = await t.startMeeting.execute({
			title: "e2e-committee",
			facilitator: { id: "claude-orchestrator" },
			members: [
				{
					id: "coder",
					adapter: "codex-cli",
					systemPrompt:
						"You are a terse pragmatic engineer. Answer in one or two sentences. If you have nothing to add, respond with exactly <PASS/> and nothing else.",
					extraFlags: ["--skip-git-repo-check"],
				},
				{
					id: "reviewer",
					adapter: "claude-code-cli",
					systemPrompt:
						"You are a careful reviewer. Answer in one or two sentences. If you have nothing to add, respond with exactly <PASS/> and nothing else.",
				},
			],
			defaultMaxRounds: 3,
		});

		const sent = await t.sendMessage.execute({
			meetingId: started.meetingId,
			text: "In one word, which should a new CLI tool prefer: `argparse` or `click`? If you both already made your choice, just PASS.",
			maxRounds: 3,
			turnTimeoutMs: 120_000,
		});

		// Poll get_response until terminal.
		let cursor: string | undefined = sent.cursor;
		const all: Array<{ author: string; kind: string; round: number; text: string }> = [];
		let finalStatus = "running";
		let finalReason: string | null = null;
		const deadline = Date.now() + 480_000;
		while (Date.now() < deadline) {
			const r = await t.getResponse.execute({
				jobId: sent.jobId,
				...(cursor !== undefined ? { cursor } : {}),
				limit: 500,
				waitMs: 5_000,
			});
			for (const m of r.messages) {
				all.push({ author: String(m.author), kind: m.kind, round: m.round, text: m.text });
			}
			cursor = r.nextCursor;
			if (r.status !== "queued" && r.status !== "running") {
				finalStatus = r.status;
				finalReason = r.terminationReason;
				// Drain remaining.
				while (true) {
					const drain = await t.getResponse.execute({
						jobId: sent.jobId,
						cursor,
						limit: 500,
					});
					if (drain.messages.length === 0) {
						break;
					}
					for (const m of drain.messages) {
						all.push({
							author: String(m.author),
							kind: m.kind,
							round: m.round,
							text: m.text,
						});
					}
					cursor = drain.nextCursor;
					if (!drain.hasMore) {
						break;
					}
				}
				break;
			}
		}

		// eslint-disable-next-line no-console
		console.log(
			"E2E transcript:\n" +
				all
					.map((m) => `  [r${m.round} ${m.kind} ${m.author}] ${m.text.slice(0, 200)}`)
					.join("\n"),
		);

		expect(finalStatus).toBe("completed");
		// Either all-passed or max-rounds is acceptable for a live committee.
		expect(["all-passed", "max-rounds"]).toContain(finalReason);
		// Facilitator message + at least one member speech.
		expect(all.some((m) => m.round === 0)).toBe(true);
		expect(all.some((m) => m.round >= 1 && m.kind === "speech")).toBe(true);

		await t.jobRunner.shutdown();
	}, 480_000);
});
