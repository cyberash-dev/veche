import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import type { SpawnFn, SpawnResult } from "../commands/install.js";

export type RawSpawnFn = (
	command: string,
	args: readonly string[],
	options: SpawnOptions,
) => ChildProcess;

export type Platform = "win32" | "darwin" | "linux" | (string & {});

export type WhichFn = (command: string) => Promise<string | null>;

export interface HostSpawnerDeps {
	readonly platform: Platform;
	readonly which: WhichFn;
	readonly rawSpawn: RawSpawnFn;
}

const isWindowsWrapper = (resolved: string): boolean => {
	const lower = resolved.toLowerCase();
	return lower.endsWith(".cmd") || lower.endsWith(".bat");
};

export const quoteWindowsArg = (arg: string): string => {
	const escaped = arg.replace(
		/(\\*)"/g,
		(_, backslashes: string) => `${backslashes}${backslashes}\\"`,
	);
	const trailingFixed = escaped.replace(/(\\+)$/, (m) => m.repeat(2));
	return `"${trailingFixed}"`;
};

export const defaultWhich: WhichFn = async (command) => {
	if (!command) {
		return null;
	}
	if (command.includes(path.sep) || path.isAbsolute(command)) {
		try {
			await access(command, constants.F_OK);
			return command;
		} catch {
			return null;
		}
	}
	const pathEnv = process.env.PATH ?? "";
	const pathExt =
		process.platform === "win32"
			? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
			: [""];
	for (const dir of pathEnv.split(path.delimiter)) {
		if (!dir) {
			continue;
		}
		for (const ext of pathExt) {
			const candidate = path.join(dir, `${command}${ext}`);
			try {
				await access(candidate, constants.F_OK);
				return candidate;
			} catch {
				// keep searching
			}
		}
	}
	return null;
};

export const buildHostSpawner = (deps: HostSpawnerDeps): SpawnFn => {
	return async (command, args): Promise<SpawnResult> => {
		const resolved = await deps.which(command);
		if (resolved === null) {
			return { code: -1, stdout: "", stderr: "", missing: true };
		}

		let launchCommand: string;
		let launchArgs: readonly string[];
		let launchOptions: SpawnOptions;

		if (deps.platform === "win32" && isWindowsWrapper(resolved)) {
			const cmdLine = [resolved, ...args].map(quoteWindowsArg).join(" ");
			launchCommand = "cmd.exe";
			launchArgs = ["/d", "/s", "/c", cmdLine];
			launchOptions = {
				stdio: ["ignore", "pipe", "pipe"],
				windowsVerbatimArguments: true,
			};
		} else {
			launchCommand = resolved;
			launchArgs = args;
			launchOptions = { stdio: ["ignore", "pipe", "pipe"] };
		}

		return new Promise<SpawnResult>((resolve) => {
			let child: ChildProcess;
			try {
				child = deps.rawSpawn(launchCommand, [...launchArgs], launchOptions);
			} catch (err) {
				resolve({
					code: -1,
					stdout: "",
					stderr: (err as Error).message ?? "",
					missing: false,
				});
				return;
			}
			let stdout = "";
			let stderr = "";
			child.stdout?.setEncoding("utf8");
			child.stderr?.setEncoding("utf8");
			child.stdout?.on("data", (chunk: string) => {
				stdout += chunk;
			});
			child.stderr?.on("data", (chunk: string) => {
				stderr += chunk;
			});
			child.on("error", (err: NodeJS.ErrnoException) => {
				resolve({
					code: -1,
					stdout,
					stderr: stderr + (err.message ?? ""),
					missing: false,
				});
			});
			child.on("close", (code) => {
				resolve({ code: code ?? 1, stdout, stderr, missing: false });
			});
		});
	};
};

export const realSpawner: SpawnFn = buildHostSpawner({
	platform: process.platform,
	which: defaultWhich,
	rawSpawn: nodeSpawn,
});
