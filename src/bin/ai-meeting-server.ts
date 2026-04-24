#!/usr/bin/env node
import { bootstrap } from "../infra/bootstrap.js";

const main = async (): Promise<void> => {
	const { mcp, shutdown } = await bootstrap();
	const stop = async (signal: string): Promise<void> => {
		process.stderr.write(
			`\n{"ts":"${new Date().toISOString()}","level":"info","event":"bootstrap.signal","signal":"${signal}"}\n`,
		);
		try {
			await shutdown();
		} finally {
			process.exit(0);
		}
	};
	process.on("SIGINT", () => {
		void stop("SIGINT");
	});
	process.on("SIGTERM", () => {
		void stop("SIGTERM");
	});
	await mcp.connect();
};

main().catch((err) => {
	process.stderr.write(
		`${JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "bootstrap.fatal", error: (err as Error).message })}\n`,
	);
	process.exit(1);
});
