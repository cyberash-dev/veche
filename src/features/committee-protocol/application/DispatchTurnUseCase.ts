import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import type { ParticipantId } from "../../../shared/types/ids.js";
import type { Session } from "../../agent-integration/domain/Session.js";
import type {
	MessageView,
	Turn,
	TurnError,
	TurnResult,
} from "../../agent-integration/domain/Turn.js";
import type { AgentAdapterPort } from "../../agent-integration/ports/AgentAdapterPort.js";
import type { Participant } from "../../meeting/domain/Participant.js";
import { classifyResponse, PASS_PROTOCOL_SUFFIX } from "../domain/PassSignal.js";

export interface DispatchTurnInput {
	readonly session: Session;
	readonly participant: Participant;
	readonly transcriptPrefix: readonly MessageView[];
	readonly facilitatorMessage: MessageView | null;
	readonly roundNumber: number;
	readonly timeoutMs: number;
	readonly cancellationSignal: AbortSignal;
}

export const MAX_ATTEMPTS_PER_TURN = 3;

export class DispatchTurnUseCase {
	constructor(
		private readonly deps: {
			readonly adapterFor: (participantId: ParticipantId) => AgentAdapterPort;
			readonly clock: ClockPort;
			readonly logger: LoggerPort;
			readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
		},
	) {}

	async execute(input: DispatchTurnInput): Promise<TurnResult> {
		const adapter = this.deps.adapterFor(input.participant.id);
		const systemPrompt =
			input.session.providerRef === null
				? this.composeSystemPrompt(input.participant.systemPrompt)
				: null;

		const prompt = this.buildPrompt(input);
		const turn: Turn = {
			session: input.session,
			participantId: input.participant.id,
			prompt,
			transcriptPrefix: input.transcriptPrefix,
			systemPrompt,
			workdir: input.participant.workdir,
			model: input.participant.model,
			extraFlags: input.participant.extraFlags,
			env: input.participant.env,
			roundNumber: input.roundNumber,
			timeoutMs: input.timeoutMs,
			cancellationSignal: input.cancellationSignal,
		};

		let lastError: TurnError | null = null;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_TURN; attempt += 1) {
			if (input.cancellationSignal.aborted) {
				return this.failureResult({
					code: "AdapterTurnTimeout",
					message: "cancelled",
					retryable: false,
				});
			}
			const start = this.deps.clock.monoNow();
			const result = await adapter.sendTurn(turn);
			const durationMs = this.deps.clock.monoNow() - start;

			if (result.kind === "speech" || result.kind === "pass") {
				const classification = classifyResponse(
					result.kind === "pass" ? result.text : result.text,
				);
				if (classification.kind === "pass") {
					return {
						kind: "pass",
						text: "<PASS/>",
						providerRef: result.providerRef,
						durationMs,
						error: null,
					};
				}
				return {
					kind: "speech",
					text: classification.text,
					providerRef: result.providerRef,
					durationMs,
					error: null,
				};
			}

			lastError = result.error;
			if (!result.error.retryable || attempt === MAX_ATTEMPTS_PER_TURN) {
				return {
					kind: "failure",
					text: null,
					providerRef: result.providerRef,
					durationMs,
					error: result.error,
				};
			}
			const backoff = Math.min(5000, 250 * 2 ** (attempt - 1));
			this.deps.logger.warn("adapter.turn.retry", {
				participantId: input.participant.id,
				attempt,
				backoff,
				errorCode: result.error.code,
			});
			try {
				await (this.deps.sleep ?? defaultSleep)(backoff, input.cancellationSignal);
			} catch {
				return this.failureResult({
					code: "AdapterTurnTimeout",
					message: "cancelled during backoff",
					retryable: false,
				});
			}
		}
		return this.failureResult(
			lastError ?? {
				code: "AdapterInvocationError",
				message: "exhausted retries",
				retryable: false,
			},
		);
	}

	private buildPrompt(input: DispatchTurnInput): string {
		const blocks: string[] = [];
		blocks.push(`[meeting-round=${input.roundNumber} self=${input.participant.id}]`);
		if (input.facilitatorMessage) {
			blocks.push(
				`[facilitator=${input.facilitatorMessage.authorId}]\n${input.facilitatorMessage.text}`,
			);
		}
		for (const m of input.transcriptPrefix) {
			const kind = m.kind ?? "speech";
			blocks.push(
				`[author=${m.authorId} role=${m.authorRole} round=${m.round} kind=${kind}]\n${m.text}`,
			);
		}
		return blocks.join("\n\n");
	}

	private composeSystemPrompt(userPrompt: string | null): string {
		const base = userPrompt?.trim() ?? "";
		return base.length > 0 ? `${base}\n\n${PASS_PROTOCOL_SUFFIX}` : PASS_PROTOCOL_SUFFIX;
	}

	private failureResult(error: TurnError): TurnResult {
		return {
			kind: "failure",
			text: null,
			providerRef: null,
			durationMs: 0,
			error,
		};
	}
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
	new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new Error("aborted"));
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(new Error("aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
