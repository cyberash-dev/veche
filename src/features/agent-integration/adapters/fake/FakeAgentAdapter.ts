import type { ClockPort } from "../../../../shared/ports/ClockPort.js";
import type { AdapterKind } from "../../../meeting/domain/Participant.js";
import type { Session } from "../../domain/Session.js";
import type { Turn, TurnResult } from "../../domain/Turn.js";
import type {
	AdapterCapabilities,
	AgentAdapterPort,
	OpenSessionInput,
} from "../../ports/AgentAdapterPort.js";

export type FakeTurnScript =
	| { readonly kind: "speech"; readonly text: string; readonly delayMs?: number }
	| { readonly kind: "pass"; readonly delayMs?: number }
	| {
			readonly kind: "failure";
			readonly code: string;
			readonly message: string;
			readonly retryable: boolean;
			readonly delayMs?: number;
	  };

/**
 * Deterministic adapter for testing committee-protocol and use-case logic.
 * Script values are consumed FIFO per participantId; running out throws.
 */
export class FakeAgentAdapter implements AgentAdapterPort {
	private readonly scripts = new Map<string, FakeTurnScript[]>();
	public readonly turns: Array<{ turn: Turn; result: TurnResult }> = [];
	public readonly opened: Session[] = [];
	public readonly closed: Session[] = [];

	constructor(
		private readonly adapter: AdapterKind,
		private readonly clock: ClockPort,
	) {}

	enqueue(participantId: string, script: FakeTurnScript | FakeTurnScript[]): void {
		const list = Array.isArray(script) ? script : [script];
		const existing = this.scripts.get(participantId) ?? [];
		existing.push(...list);
		this.scripts.set(participantId, existing);
	}

	capabilities(): AdapterCapabilities {
		return { adapter: this.adapter, supportsWorkdir: true, supportsSystemPrompt: true };
	}

	async openSession(input: OpenSessionInput): Promise<Session> {
		const session: Session = {
			id: input.sessionId,
			adapter: this.adapter,
			participantId: input.participantId,
			meetingId: input.meetingId,
			providerRef: input.sessionId,
			status: "open",
			openedAt: this.clock.now(),
			closedAt: null,
		};
		this.opened.push(session);
		return session;
	}

	async sendTurn(turn: Turn): Promise<TurnResult> {
		const queue = this.scripts.get(turn.participantId) ?? [];
		const next = queue.shift();
		if (!next) {
			throw new Error(
				`FakeAgentAdapter: no script remaining for participant ${turn.participantId}`,
			);
		}
		this.scripts.set(turn.participantId, queue);
		if (next.delayMs !== undefined && next.delayMs > 0) {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					turn.cancellationSignal.removeEventListener("abort", onAbort);
					resolve();
				}, next.delayMs);
				const onAbort = (): void => {
					clearTimeout(timer);
					reject(new Error("cancelled"));
				};
				if (turn.cancellationSignal.aborted) {
					clearTimeout(timer);
					reject(new Error("cancelled"));
					return;
				}
				turn.cancellationSignal.addEventListener("abort", onAbort, { once: true });
			});
		}
		let result: TurnResult;
		if (next.kind === "speech") {
			result = {
				kind: "speech",
				text: next.text,
				providerRef: turn.session.providerRef,
				durationMs: 1,
				error: null,
			};
		} else if (next.kind === "pass") {
			result = {
				kind: "pass",
				text: "<PASS/>",
				providerRef: turn.session.providerRef,
				durationMs: 1,
				error: null,
			};
		} else {
			result = {
				kind: "failure",
				text: null,
				providerRef: turn.session.providerRef,
				durationMs: 1,
				error: { code: next.code, message: next.message, retryable: next.retryable },
			};
		}
		this.turns.push({ turn, result });
		return result;
	}

	async closeSession(session: Session): Promise<Session> {
		const closed: Session = { ...session, status: "closed", closedAt: this.clock.now() };
		this.closed.push(closed);
		return closed;
	}

	isScriptExhausted(): boolean {
		for (const queue of this.scripts.values()) {
			if (queue.length > 0) {
				return false;
			}
		}
		return true;
	}
}
