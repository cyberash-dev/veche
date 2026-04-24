import type { ClockPort } from "../../../../shared/ports/ClockPort.js";
import type { LoggerPort } from "../../../../shared/ports/LoggerPort.js";
import type { SessionId } from "../../../../shared/types/ids.js";
import { classifyResponse } from "../../../committee-protocol/domain/PassSignal.js";
import { AdapterNotAvailable } from "../../domain/errors.js";
import type { Session } from "../../domain/Session.js";
import type { Turn, TurnResult } from "../../domain/Turn.js";
import type {
	AdapterCapabilities,
	AgentAdapterPort,
	OpenSessionInput,
} from "../../ports/AgentAdapterPort.js";
import which from "../codex-cli/which.js";
import { runSubprocess } from "../shared/SubprocessRunner.js";

interface RegistryEntry {
	session: Session;
	systemPromptPending: boolean;
	systemPrompt: string | null;
	workdir: string | null;
	model: string | null;
	extraFlags: readonly string[];
	env: Readonly<Record<string, string>>;
	hasStartedConversation: boolean;
}

export interface ClaudeCodeCliAdapterOptions {
	readonly bin?: string;
	readonly defaultDisallowedTools?: readonly string[];
}

const DEFAULT_DISALLOWED = ["Bash", "Edit", "Write", "NotebookEdit"];
const FORBIDDEN_ENV = new Set(["HOME", "PATH", "CLAUDE_BIN", "CODEX_BIN"]);

/**
 * Adapter for `claude -p`. See spec/features/agent-integration/claude-code-cli-adapter.usecase.md.
 * Enforces the recursion guard: `--bare --strict-mcp-config --mcp-config {"mcpServers":{}}`.
 */
export class ClaudeCodeCliAgentAdapter implements AgentAdapterPort {
	private readonly sessions = new Map<SessionId, RegistryEntry>();
	private readonly bin: string;
	private readonly defaultDisallowed: readonly string[];
	private availabilityChecked = false;
	private availabilityError: AdapterNotAvailable | null = null;

	constructor(
		private readonly deps: {
			readonly clock: ClockPort;
			readonly logger: LoggerPort;
		},
		options: ClaudeCodeCliAdapterOptions = {},
	) {
		this.bin = options.bin ?? process.env.CLAUDE_BIN ?? "claude";
		this.defaultDisallowed = options.defaultDisallowedTools ?? DEFAULT_DISALLOWED;
	}

	capabilities(): AdapterCapabilities {
		return { adapter: "claude-code-cli", supportsWorkdir: true, supportsSystemPrompt: true };
	}

	async openSession(input: OpenSessionInput): Promise<Session> {
		await this.ensureAvailable();
		const session: Session = {
			id: input.sessionId,
			adapter: "claude-code-cli",
			participantId: input.participantId,
			meetingId: input.meetingId,
			providerRef: input.sessionId,
			status: "open",
			openedAt: this.deps.clock.now(),
			closedAt: null,
		};
		this.sessions.set(input.sessionId, {
			session,
			systemPromptPending: input.systemPrompt !== null,
			systemPrompt: input.systemPrompt,
			workdir: input.workdir,
			model: input.model,
			extraFlags: input.extraFlags,
			env: input.env,
			hasStartedConversation: false,
		});
		return session;
	}

	async sendTurn(turn: Turn): Promise<TurnResult> {
		const entry = this.sessions.get(turn.session.id);
		if (!entry || entry.session.status === "closed") {
			throw new AdapterNotAvailable(
				"claude-session-closed",
				`session ${turn.session.id} is not open`,
			);
		}
		const providerRef = entry.session.providerRef ?? entry.session.id;
		// Turn 1 creates the conversation via --session-id; subsequent turns resume it via
		// --resume <id>. Re-using --session-id on a turn after the first causes
		// "Session ID ... is already in use".
		const isFirstTurn = !entry.hasStartedConversation;
		const args: string[] = [];
		args.push("-p");
		if (isFirstTurn) {
			args.push("--session-id", providerRef);
		} else {
			args.push("--resume", providerRef);
		}
		args.push("--output-format", "json");
		args.push("--input-format", "text");
		// Recursion guard: lock the child to an empty MCP config so it cannot reconnect
		// to this (or any) ai-meeting server and spawn more children.
		args.push("--strict-mcp-config");
		args.push("--mcp-config", '{"mcpServers":{}}');
		args.push("--permission-mode", "default");
		// --disallowedTools takes variadic values (consumes everything up to the next flag).
		// Use the `=` form so the comma-separated list is bound to this flag only and the
		// positional prompt below is NOT consumed by the tool parser.
		if (!this.hasAllowedToolsOverride(entry.extraFlags)) {
			args.push(`--disallowedTools=${this.defaultDisallowed.join(",")}`);
		}
		if (entry.model) {
			args.push("--model", entry.model);
		}
		if (entry.workdir) {
			args.push("--add-dir", entry.workdir);
		}
		if (entry.systemPromptPending && entry.systemPrompt) {
			args.push("--append-system-prompt", entry.systemPrompt);
		}
		for (const f of entry.extraFlags) {
			args.push(f);
		}
		args.push(turn.prompt);

		const env = this.buildEnv(entry.env);
		const outcome = await runSubprocess({
			bin: this.bin,
			args,
			env,
			...(entry.workdir !== null ? { cwd: entry.workdir } : {}),
			timeoutMs: turn.timeoutMs,
			cancellationSignal: turn.cancellationSignal,
		});

		if (outcome.cancelled) {
			return this.failure(
				{ code: "claude-cancelled", message: "cancelled", retryable: false },
				outcome.durationMs,
				providerRef,
			);
		}
		if (outcome.timedOut) {
			return this.failure(
				{
					code: "AdapterTurnTimeout",
					message: "claude exceeded timeoutMs",
					retryable: true,
				},
				outcome.durationMs,
				providerRef,
			);
		}
		if (outcome.code === 0) {
			interface ClaudeJsonResult {
				result?: string;
				subtype?: string;
				session_id?: string;
			}
			let parsed: ClaudeJsonResult;
			try {
				parsed = JSON.parse(outcome.stdout) as ClaudeJsonResult;
			} catch {
				return this.failure(
					{
						code: "claude-parse-json",
						message: "stdout is not valid JSON",
						retryable: false,
					},
					outcome.durationMs,
					providerRef,
				);
			}
			if (typeof parsed.result !== "string") {
				return this.failure(
					{
						code: "claude-parse-empty",
						message: "missing result field",
						retryable: false,
					},
					outcome.durationMs,
					providerRef,
				);
			}
			if (parsed.subtype && parsed.subtype !== "success") {
				return this.failure(
					{
						code: "claude-runtime",
						message: parsed.result,
						retryable: true,
					},
					outcome.durationMs,
					providerRef,
				);
			}
			if (parsed.session_id && parsed.session_id !== providerRef) {
				return this.failure(
					{
						code: "claude-session-mismatch",
						message: `expected session_id ${providerRef}, got ${parsed.session_id}`,
						retryable: false,
					},
					outcome.durationMs,
					providerRef,
				);
			}
			entry.systemPromptPending = false;
			entry.hasStartedConversation = true;
			const classified = classifyResponse(parsed.result);
			if (classified.kind === "pass") {
				return {
					kind: "pass",
					text: "<PASS/>",
					providerRef,
					durationMs: outcome.durationMs,
					error: null,
				};
			}
			return {
				kind: "speech",
				text: classified.text,
				providerRef,
				durationMs: outcome.durationMs,
				error: null,
			};
		}
		if (outcome.code === 2) {
			return this.failure(
				{
					code: "claude-usage",
					message: `claude exited with usage error: ${outcome.stderr.slice(0, 500)}`,
					retryable: false,
				},
				outcome.durationMs,
				providerRef,
			);
		}
		if (outcome.code === 130) {
			return this.failure(
				{ code: "claude-sigint", message: "claude received SIGINT", retryable: false },
				outcome.durationMs,
				providerRef,
			);
		}
		return this.failure(
			{
				code: `claude-exit-${outcome.code ?? "unknown"}`,
				message: outcome.stderr.trim().split("\n").pop() ?? `exit ${outcome.code}`,
				retryable: true,
			},
			outcome.durationMs,
			providerRef,
		);
	}

	async closeSession(session: Session): Promise<Session> {
		const entry = this.sessions.get(session.id);
		if (entry) {
			entry.session = { ...entry.session, status: "closed", closedAt: this.deps.clock.now() };
			this.sessions.delete(session.id);
			return entry.session;
		}
		return { ...session, status: "closed", closedAt: this.deps.clock.now() };
	}

	private async ensureAvailable(): Promise<void> {
		if (this.availabilityChecked) {
			if (this.availabilityError) {
				throw this.availabilityError;
			}
			return;
		}
		this.availabilityChecked = true;
		const resolved = await which(this.bin);
		if (!resolved) {
			this.availabilityError = new AdapterNotAvailable(
				"claude-binary-not-found",
				`claude CLI not found on PATH (bin=${this.bin})`,
			);
			throw this.availabilityError;
		}
	}

	private buildEnv(overrides: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = { ...process.env };
		for (const [k, v] of Object.entries(overrides)) {
			if (FORBIDDEN_ENV.has(k)) {
				continue;
			}
			env[k] = v;
		}
		return env;
	}

	private hasAllowedToolsOverride(flags: readonly string[]): boolean {
		return flags.includes("--allowedTools") || flags.includes("--disallowedTools");
	}

	private failure(
		error: { code: string; message: string; retryable: boolean },
		durationMs: number,
		providerRef: string | null,
	): TurnResult {
		return {
			kind: "failure",
			text: null,
			providerRef,
			durationMs,
			error,
		};
	}
}
