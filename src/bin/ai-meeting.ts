#!/usr/bin/env node
import { runCli } from "../adapters/inbound/cli/AiMeetingCli.js";
import { FileMeetingStore } from "../features/persistence/adapters/file/FileMeetingStore.js";
import { loadConfig } from "../infra/config.js";
import { StructuredLogger } from "../infra/StructuredLogger.js";
import { SystemClock } from "../infra/SystemClock.js";

const VERSION = "0.1.0";

const extractHomeOverride = (argv: readonly string[]): string | null => {
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i]!;
		if (a === "--home" && i + 1 < argv.length) {
			return argv[i + 1]!;
		}
		if (a.startsWith("--home=")) {
			return a.slice("--home=".length);
		}
	}
	return null;
};

const main = async (): Promise<void> => {
	const argv = process.argv.slice(2);
	const config = await loadConfig();
	const override = extractHomeOverride(argv);
	const rootDir = override ?? config.home;
	const logger = new StructuredLogger("error", { svc: "ai-meeting-cli" });
	const clock = new SystemClock();
	const store = new FileMeetingStore({ clock, logger }, { rootDir });

	const exit = await runCli({
		store,
		clock,
		logger,
		version: VERSION,
		argv,
		stdout: (s) => process.stdout.write(s),
		stderr: (s) => process.stderr.write(s),
	});
	process.exit(exit);
};

main().catch((err) => {
	process.stderr.write(`${(err as Error).message}\n`);
	process.exit(1);
});
