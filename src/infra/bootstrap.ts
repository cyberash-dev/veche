import { AiMeetingMcpServer } from "../adapters/inbound/mcp/AiMeetingMcpServer.js";
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
import type { Participant } from "../features/meeting/domain/Participant.js";
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
import { FileMeetingStore } from "../features/persistence/adapters/file/FileMeetingStore.js";
import { InMemoryMeetingStore } from "../features/persistence/adapters/in-memory/InMemoryMeetingStore.js";
import type { MeetingStorePort } from "../features/persistence/ports/MeetingStorePort.js";
import type { ParticipantId } from "../shared/types/ids.js";
import { loadConfig } from "./config.js";
import { StructuredLogger } from "./StructuredLogger.js";
import { SystemClock } from "./SystemClock.js";
import { UuidIdGen } from "./UuidIdGen.js";

export interface BootstrapResult {
	readonly mcp: AiMeetingMcpServer;
	readonly shutdown: () => Promise<void>;
}

export const bootstrap = async (): Promise<BootstrapResult> => {
	const config = await loadConfig();
	const logger = new StructuredLogger(config.logLevel, { svc: "ai-meeting-server" });
	logger.info("bootstrap.start", {
		home: config.home,
		storeKind: config.storeKind,
		maxRoundsCap: config.maxRoundsCap,
	});
	const clock = new SystemClock();
	const ids = new UuidIdGen();
	const store: MeetingStorePort =
		config.storeKind === "memory"
			? new InMemoryMeetingStore(clock)
			: new FileMeetingStore({ clock, logger }, { rootDir: config.home });

	const codex = new CodexCliAgentAdapter({
		clock,
		logger: logger.child({ adapter: "codex-cli" }),
	});
	const claude = new ClaudeCodeCliAgentAdapter({
		clock,
		logger: logger.child({ adapter: "claude-code-cli" }),
	});
	const adapters: AgentAdapterRegistryPort = {
		get(kind): AgentAdapterPort {
			if (kind === "codex-cli") {
				return codex;
			}
			if (kind === "claude-code-cli") {
				return claude;
			}
			throw new Error(`Unknown adapter: ${kind}`);
		},
	};

	const profileResolver = new ProfileResolver(config.userConfig);

	// Adapter lookup by participantId is tricky here — we need a way to find the kind.
	// The discussion runner hands us a participantId; we resolve the adapter via the current
	// meeting snapshot, which the runner passes through sessions map. So adapterFor consults
	// a mutable map populated by the runner itself.
	const adapterByParticipant = new Map<ParticipantId, AgentAdapterPort>();
	const adapterFor = (pid: ParticipantId): AgentAdapterPort => {
		const found = adapterByParticipant.get(pid);
		if (found) {
			return found;
		}
		throw new Error(`No adapter registered for participant ${pid}`);
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

	// Populate adapterByParticipant from a meeting's participants when the runner starts.
	const instrumentedRunner = {
		async run(input: Parameters<DiscussionRunner["run"]>[0]): Promise<void> {
			const snap = await store.loadMeeting(input.meetingId);
			for (const p of snap.participants) {
				if (p.role === "member" && p.adapter) {
					adapterByParticipant.set(p.id, adapters.get(p.adapter));
				}
			}
			return discussion.run(input);
		},
	} as DiscussionRunner;
	const jobRunner = new JobRunner({ runner: instrumentedRunner, logger });

	const startMeeting = new StartMeetingUseCase({
		store,
		clock,
		ids,
		logger,
		adapters,
		profileResolver,
		maxRoundsCap: config.maxRoundsCap,
	});
	const sendMessage = new SendMessageUseCase({
		store,
		clock,
		ids,
		logger,
		jobRunner,
		maxRoundsCap: config.maxRoundsCap,
	});
	const getResponse = new GetResponseUseCase({ store });
	const listMeetings = new ListMeetingsUseCase({ store });
	const getTranscript = new GetTranscriptUseCase({ store });
	const cancelJob = new CancelJobUseCase({ store, clock, jobRunner });
	const endMeeting = new EndMeetingUseCase({ store, clock, logger, adapters, cancelJob });
	// Seed adapter lookup for any previously-joined participants so start_meeting's rollback
	// paths continue to work.
	// (No-op here; participants come from meeting loads.)
	void ({} as Participant);

	const mcp = new AiMeetingMcpServer({
		logger,
		startMeeting,
		sendMessage,
		getResponse,
		listMeetings,
		getTranscript,
		endMeeting,
		cancelJob,
	});

	const shutdown = async (): Promise<void> => {
		logger.info("bootstrap.shutdown", {});
		await jobRunner.shutdown();
		await mcp.close();
	};

	return { mcp, shutdown };
};
