import { SetHumanParticipationUseCase } from "../../../../features/meeting/application/SetHumanParticipationUseCase.js";
import { SubmitHumanTurnUseCase } from "../../../../features/meeting/application/SubmitHumanTurnUseCase.js";
import type { MeetingStorePort } from "../../../../features/persistence/ports/MeetingStorePort.js";
import type { ClockPort } from "../../../../shared/ports/ClockPort.js";
import type { IdGenPort } from "../../../../shared/ports/IdGenPort.js";
import type { LoggerPort } from "../../../../shared/ports/LoggerPort.js";
import { WatchServer } from "../../web/WatchServer.js";
import { openInBrowser } from "../lib/opener.js";

export interface WatchCommand {
	readonly host: string;
	readonly port: number;
	readonly noOpen: boolean;
	readonly useColor: boolean;
}

export interface WatchDeps {
	readonly store: MeetingStorePort;
	readonly clock: ClockPort;
	readonly ids: IdGenPort;
	readonly logger: LoggerPort;
	readonly version: string;
	readonly stderr: (s: string) => void;
	readonly registerSignals?: (handler: () => void) => () => void;
	readonly waitForShutdown?: () => Promise<void>;
}

const isLoopback = (host: string): boolean =>
	host === "127.0.0.1" || host === "::1" || host === "localhost" || host.startsWith("127.");

const defaultRegisterSignals = (handler: () => void): (() => void) => {
	const wrapped = (): void => handler();
	process.once("SIGINT", wrapped);
	process.once("SIGTERM", wrapped);
	return () => {
		process.off("SIGINT", wrapped);
		process.off("SIGTERM", wrapped);
	};
};

export const runWatch = async (cmd: WatchCommand, deps: WatchDeps): Promise<number> => {
	const server = new WatchServer(
		{ host: cmd.host, port: cmd.port, version: deps.version },
		{
			store: deps.store,
			clock: deps.clock,
			logger: deps.logger,
			submitHumanTurn: new SubmitHumanTurnUseCase({
				store: deps.store,
				clock: deps.clock,
				ids: deps.ids,
			}),
			setHumanParticipation: new SetHumanParticipationUseCase({
				store: deps.store,
				clock: deps.clock,
			}),
		},
	);

	let listening: { url: string; host: string; port: number };
	try {
		listening = await server.start();
	} catch (err) {
		deps.stderr(`failed to bind ${cmd.host}:${cmd.port}: ${(err as Error).message}\n`);
		return 2;
	}

	deps.stderr(`listening on ${listening.url}  (Ctrl-C to stop)\n`);
	if (!isLoopback(cmd.host)) {
		deps.stderr(
			`warn: binding to ${cmd.host}; this exposes the unauthenticated viewer beyond loopback\n`,
		);
	}

	if (!cmd.noOpen) {
		const result = openInBrowser(listening.url);
		if (result === "ok") {
			deps.stderr(`opened ${listening.url}\n`);
		} else if (result === "no-opener") {
			deps.stderr(
				`no browser opener available on ${process.platform}; URL is ${listening.url}\n`,
			);
		} else {
			deps.stderr(`opener failed; URL is ${listening.url}\n`);
		}
	}

	const register = deps.registerSignals ?? defaultRegisterSignals;
	const shutdownPromise: Promise<void> =
		deps.waitForShutdown !== undefined
			? deps.waitForShutdown()
			: new Promise<void>((resolve) => {
					const stopper = register(() => {
						stopper();
						resolve();
					});
				});

	await shutdownPromise;
	deps.stderr("shutting down…\n");
	await server.stop();
	deps.stderr("bye.\n");
	return 0;
};
