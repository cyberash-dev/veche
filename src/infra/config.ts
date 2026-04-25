import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserConfigFile } from "../features/agent-integration/domain/Profile.js";
import type { LogLevel } from "../shared/ports/LoggerPort.js";

export interface ServerConfig {
	readonly home: string;
	readonly logLevel: LogLevel;
	readonly storeKind: "memory" | "file";
	readonly maxRoundsCap: number;
	readonly userConfig: UserConfigFile | null;
}

const parseLogLevel = (raw: string | undefined): LogLevel => {
	switch (raw) {
		case "trace":
		case "debug":
		case "info":
		case "warn":
		case "error":
			return raw;
		default:
			return "info";
	}
};

export const loadConfig = async (): Promise<ServerConfig> => {
	const home = process.env.VECHE_HOME ?? path.join(os.homedir(), ".veche");
	const logLevel = parseLogLevel(process.env.VECHE_LOG_LEVEL);
	const storeEnv = process.env.VECHE_STORE ?? "file";
	const storeKind: "memory" | "file" = storeEnv === "memory" ? "memory" : "file";
	const capRaw = process.env.VECHE_MAX_ROUNDS_CAP;
	const maxRoundsCap = capRaw ? Math.max(1, Number.parseInt(capRaw, 10) || 16) : 16;

	let userConfig: UserConfigFile | null = null;
	const configPath = path.join(home, "config.json");
	try {
		const raw = await fs.readFile(configPath, "utf8");
		const parsed = JSON.parse(raw) as UserConfigFile;
		if (parsed.version === 1 && Array.isArray(parsed.profiles)) {
			userConfig = parsed;
		}
	} catch {
		userConfig = null;
	}

	return { home, logLevel, storeKind, maxRoundsCap, userConfig };
};
