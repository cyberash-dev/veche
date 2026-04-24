import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClockPort } from "../../../../shared/ports/ClockPort.js";
import type { LoggerPort } from "../../../../shared/ports/LoggerPort.js";
import type { SessionId } from "../../../../shared/types/ids.js";
import { classifyResponse } from "../../../committee-protocol/domain/PassSignal.js";
import {
	AdapterConfigInvalid,
	AdapterInvocationError,
	AdapterNotAvailable,
	AdapterParseError,
	AdapterTurnTimeout,
} from "../../domain/errors.js";
import type { Session } from "../../domain/Session.js";
import type { Turn, TurnResult } from "../../domain/Turn.js";
import type {
	AdapterCapabilities,
	AgentAdapterPort,
	OpenSessionInput,
} from "../../ports/AgentAdapterPort.js";
import { runSubprocess } from "../shared/SubprocessRunner.js";
import which from "./which.js";

interface RegistryEntry {
	session: Session;
	systemPromptPending: boolean;
	systemPrompt: string | null;
	workdir: string | null;
	model: string | null;
	extraFlags: readonly string[];
	env: Readonly<Record<string, string>>;
}

const FORBIDDEN_ENV = new Set(["HOME", "PATH", "CLAUDE_BIN", "CODEX_BIN"]);

export interface CodexCliAdapterOptions {
	readonly bin?: string;
	readonly defaultSandbox?: "read-only" | "workspace-write" | "danger-full-access";
}

/**
 * Adapter for `codex exec`. See spec/features/agent-integration/codex-cli-adapter.usecase.md.
 */
export class CodexCliAgentAdapter implements AgentAdapterPort {
	private readonly sessions = new Map<SessionId, RegistryEntry>();
	private readonly bin: string;
	private readonly defaultSandbox: "read-only" | "workspace-write" | "danger-full-access";
	private availabilityChecked = false;
	private availabilityError: AdapterNotAvailable | null = null;

	constructor(
		private readonly deps: {
			readonly clock: ClockPort;
			readonly logger: LoggerPort;
		},
		options: CodexCliAdapterOptions = {},
	) {
		this.bin = options.bin ?? process.env.CODEX_BIN ?? "codex";
		this.defaultSandbox = options.defaultSandbox ?? "read-only";
	}

	capabilities(): AdapterCapabilities {
		return { adapter: "codex-cli", supportsWorkdir: true, supportsSystemPrompt: true };
	}

	async openSession(input: OpenSessionInput): Promise<Session> {
		await this.ensureAvailable();
		const session: Session = {
			id: input.sessionId,
			adapter: "codex-cli",
			participantId: input.participantId,
			meetingId: input.meetingId,
			providerRef: null,
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
		});
		return session;
	}

	async sendTurn(turn: Turn): Promise<TurnResult> {
		const entry = this.sessions.get(turn.session.id);
		if (!entry || entry.session.status === "closed") {
			throw new AdapterNotAvailable(
				"codex-session-closed",
				`session ${turn.session.id} is not open`,
			);
		}
		const tmpdir = await mkdtemp(path.join(os.tmpdir(), "ai-meeting-codex-"));
		const tmpPath = path.join(tmpdir, "last.txt");
		const isResume = entry.session.providerRef !== null;
		const args: string[] = ["exec"];
		if (isResume) {
			args.push("resume", entry.session.providerRef as string);
		}
		// Flags valid on both `exec` and `exec resume`:
		args.push("--json", "-o", tmpPath);
		if (entry.model) {
			args.push("--model", entry.model);
		}
		// Flags accepted only on initial `exec` (resume inherits sandbox/cwd/instructions):
		const cwd = entry.workdir ?? null;
		if (!isResume) {
			args.push("--sandbox", this.resolveSandbox(entry.extraFlags));
			if (cwd !== null) {
				args.push("--cd", cwd);
			}
			if (entry.systemPromptPending && entry.systemPrompt) {
				args.push("-c", `instructions=${JSON.stringify(entry.systemPrompt)}`);
			}
		}
		// Propagate extraFlags; drop sandbox literals since they were consumed above.
		for (const f of entry.extraFlags) {
			if (
				f === "--sandbox" ||
				f === "workspace-write" ||
				f === "danger-full-access" ||
				f === "read-only"
			) {
				continue;
			}
			args.push(f);
		}
		args.push(turn.prompt);

		const env = this.buildEnv(entry.env);
		const outcome = await runSubprocess({
			bin: this.bin,
			args,
			env,
			...(cwd !== null ? { cwd } : {}),
			timeoutMs: turn.timeoutMs,
			cancellationSignal: turn.cancellationSignal,
		});

		try {
			if (outcome.cancelled) {
				return this.failure(
					{
						code: "codex-cancelled",
						message: "cancelled",
						retryable: false,
					},
					outcome.durationMs,
					entry.session.providerRef,
				);
			}
			if (outcome.timedOut) {
				return this.failure(
					{
						code: "AdapterTurnTimeout",
						message: "codex exec exceeded timeoutMs",
						retryable: true,
					},
					outcome.durationMs,
					entry.session.providerRef,
				);
			}
			const { providerRef } = this.parseStdout(outcome.stdout);
			if (providerRef && entry.session.providerRef === null) {
				entry.session = { ...entry.session, providerRef };
			}
			if (outcome.code === 0) {
				let finalText: string | null = null;
				try {
					finalText = await readFile(tmpPath, "utf8");
				} catch {
					finalText = this.extractFinalFromEvents(outcome.stdout);
				}
				if (finalText === null) {
					throw new AdapterParseError(
						"codex-parse-empty",
						"codex produced no final message",
					);
				}
				entry.systemPromptPending = false;
				const classified = classifyResponse(finalText);
				if (classified.kind === "pass") {
					return {
						kind: "pass",
						text: "<PASS/>",
						providerRef: entry.session.providerRef,
						durationMs: outcome.durationMs,
						error: null,
					};
				}
				return {
					kind: "speech",
					text: classified.text,
					providerRef: entry.session.providerRef,
					durationMs: outcome.durationMs,
					error: null,
				};
			}
			if (outcome.code === 2) {
				throw new AdapterConfigInvalid(
					"codex-usage",
					`codex exited with usage error: ${outcome.stderr.slice(0, 500)}`,
				);
			}
			const message = outcome.stderr.trim().split("\n").pop() ?? `exit ${outcome.code}`;
			throw new AdapterInvocationError(
				"codex-generic",
				`codex exited ${outcome.code}: ${message}`,
				true,
				{ code: outcome.code, signal: outcome.signal },
			);
		} catch (err) {
			if (err instanceof AdapterConfigInvalid) {
				return this.failure(
					{ code: err.code, message: err.message, retryable: false },
					outcome.durationMs,
					entry.session.providerRef,
				);
			}
			if (err instanceof AdapterInvocationError) {
				return this.failure(
					{ code: err.code, message: err.message, retryable: err.retryable },
					outcome.durationMs,
					entry.session.providerRef,
				);
			}
			if (err instanceof AdapterParseError) {
				return this.failure(
					{ code: err.code, message: err.message, retryable: false },
					outcome.durationMs,
					entry.session.providerRef,
				);
			}
			if (err instanceof AdapterTurnTimeout) {
				return this.failure(
					{ code: err.code, message: err.message, retryable: true },
					outcome.durationMs,
					entry.session.providerRef,
				);
			}
			throw err;
		} finally {
			rm(tmpdir, { recursive: true, force: true }).catch(() => undefined);
		}
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
				"codex-binary-not-found",
				`codex CLI not found on PATH (bin=${this.bin})`,
			);
			throw this.availabilityError;
		}
		// Codex accepts either CODEX_API_KEY (CI) or persistent CLI login (~/.codex/auth.json).
		// We do not probe the login file directly because Codex owns that layout; instead we
		// let sendTurn surface an auth failure via exit code if neither is present.
	}

	private resolveSandbox(extraFlags: readonly string[]): string {
		for (let i = 0; i < extraFlags.length; i += 1) {
			if (extraFlags[i] === "--sandbox" && i + 1 < extraFlags.length) {
				return extraFlags[i + 1]!;
			}
		}
		return this.defaultSandbox;
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

	private parseStdout(stdout: string): { providerRef: string | null } {
		let providerRef: string | null = null;
		for (const rawLine of stdout.split("\n")) {
			const line = rawLine.trim();
			if (!line) {
				continue;
			}
			try {
				const obj = JSON.parse(line) as { type?: string; thread_id?: string };
				if (obj.type === "thread.started" && typeof obj.thread_id === "string") {
					providerRef = obj.thread_id;
				}
			} catch {
				// ignore non-JSON lines
			}
		}
		return { providerRef };
	}

	private extractFinalFromEvents(stdout: string): string | null {
		let last: string | null = null;
		for (const rawLine of stdout.split("\n")) {
			const line = rawLine.trim();
			if (!line) {
				continue;
			}
			try {
				const obj = JSON.parse(line) as {
					type?: string;
					item?: { type?: string; text?: string };
				};
				if (
					obj.type === "item.completed" &&
					obj.item?.type === "assistant_message" &&
					typeof obj.item.text === "string"
				) {
					last = obj.item.text;
				}
			} catch {
				// ignore
			}
		}
		return last;
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
