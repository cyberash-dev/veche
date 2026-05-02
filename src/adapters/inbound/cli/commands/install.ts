import { type ChildProcess, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findPackageRoot } from "../lib/packageRoot.js";

export type InstallTarget = "claude-code" | "codex";
export type InstallTargetSelection = InstallTarget | "both";

export interface InstallCommand {
	readonly target: InstallTargetSelection;
	readonly mcpName: string;
	readonly serverBin: string | null;
	readonly skillsOnly: boolean;
	readonly mcpOnly: boolean;
	readonly force: boolean;
	readonly dryRun: boolean;
	readonly useColor: boolean;
}

export interface SpawnResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly missing: boolean;
}

export type SpawnFn = (command: string, args: readonly string[]) => Promise<SpawnResult>;

export interface InstallDeps {
	readonly stderr: (s: string) => void;
	readonly env: NodeJS.ProcessEnv;
	readonly homedir: () => string;
	readonly packageRoot: string;
	readonly spawner: SpawnFn;
}

export const MCP_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const ENV_SETTING = "VECHE_LOG_LEVEL=info";

interface HostPlan {
	readonly target: InstallTarget;
	readonly cli: string;
	readonly skillsRoot: string;
	readonly mcpAddArgs: readonly string[];
	readonly probeArgs: readonly string[];
	readonly listArgs: readonly string[] | null;
	readonly removeArgs: readonly string[] | null;
}

const buildHostPlan = (
	target: InstallTarget,
	deps: InstallDeps,
	mcpName: string,
	serverBin: string,
): HostPlan => {
	const home = deps.homedir();
	if (target === "claude-code") {
		const cli = deps.env.CLAUDE_BIN ?? "claude";
		return {
			target,
			cli,
			skillsRoot: path.join(home, ".claude", "skills"),
			probeArgs: ["--version"],
			listArgs: ["mcp", "list"],
			removeArgs: ["mcp", "remove", mcpName, "--scope", "user"],
			mcpAddArgs: [
				"mcp",
				"add",
				mcpName,
				"--scope",
				"user",
				"-e",
				ENV_SETTING,
				"--",
				"node",
				serverBin,
			],
		};
	}
	const cli = deps.env.CODEX_BIN ?? "codex";
	return {
		target,
		cli,
		skillsRoot: path.join(home, ".codex", "skills"),
		probeArgs: ["--version"],
		listArgs: null,
		removeArgs: null,
		mcpAddArgs: ["mcp", "add", mcpName, "--env", ENV_SETTING, "--", "node", serverBin],
	};
};

const expandTargets = (selection: InstallTargetSelection): readonly InstallTarget[] =>
	selection === "both" ? ["claude-code", "codex"] : [selection];

const writeAtomic = async (filePath: string, content: string): Promise<void> => {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	await fs.writeFile(tmp, content, { mode: 0o600 });
	await fs.rename(tmp, filePath);
};

const formatArgv = (cli: string, args: readonly string[]): string => `${cli} ${args.join(" ")}`;

const claudeMcpListContains = (stdout: string, mcpName: string): boolean => {
	const escaped = mcpName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(`^${escaped}:`, "m");
	return re.test(stdout);
};

const isNotFoundStderr = (stderr: string): boolean =>
	/no such mcp server/i.test(stderr) || /not found/i.test(stderr);

export const realSpawner: SpawnFn = (command, args) =>
	new Promise<SpawnResult>((resolve) => {
		let child: ChildProcess;
		try {
			child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
		} catch {
			resolve({ code: -1, stdout: "", stderr: "", missing: true });
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
			if (err.code === "ENOENT") {
				resolve({ code: -1, stdout, stderr, missing: true });
				return;
			}
			resolve({ code: -1, stdout, stderr: stderr + (err.message ?? ""), missing: false });
		});
		child.on("close", (code) => {
			resolve({ code: code ?? 1, stdout, stderr, missing: false });
		});
	});

interface RunStepResult {
	readonly outcome: "ok" | "skipped" | "error";
	readonly message?: string;
}

const runHost = async (
	plan: HostPlan,
	cmd: InstallCommand,
	skillSource: string,
	skillMetadataSource: string | null,
	deps: InstallDeps,
): Promise<RunStepResult> => {
	const { stderr } = deps;
	const tag = `[${plan.target}]`;

	// 1. Probe the host CLI (skipped on dry-run).
	if (!cmd.dryRun) {
		const probe = await deps.spawner(plan.cli, plan.probeArgs);
		if (probe.missing) {
			const msg = `${tag} error: ${plan.cli} not found on PATH; install ${plan.cli} first or pass --force to skip this host\n`;
			stderr(msg);
			if (cmd.force) {
				stderr(`${tag} skipped\n`);
				return { outcome: "skipped" };
			}
			return { outcome: "error", message: "host-cli-missing" };
		}
	}

	// 2. Skill copy.
	if (!cmd.mcpOnly) {
		const skillRoot = path.join(plan.skillsRoot, cmd.mcpName);
		const skillTarget = path.join(skillRoot, "SKILL.md");
		if (cmd.dryRun) {
			stderr(`${tag} (dry-run) writing skill file → ${skillTarget}\n`);
		} else {
			stderr(`${tag} writing skill file → ${skillTarget}\n`);
			try {
				await writeAtomic(skillTarget, skillSource);
			} catch (err) {
				stderr(`${tag} error: cannot write ${skillTarget}: ${(err as Error).message}\n`);
				return { outcome: "error", message: "write-failed" };
			}
		}
		if (skillMetadataSource !== null) {
			const metadataTarget = path.join(skillRoot, "agents", "openai.yaml");
			if (cmd.dryRun) {
				stderr(`${tag} (dry-run) writing skill metadata → ${metadataTarget}\n`);
			} else {
				stderr(`${tag} writing skill metadata → ${metadataTarget}\n`);
				try {
					await writeAtomic(metadataTarget, skillMetadataSource);
				} catch (err) {
					stderr(
						`${tag} error: cannot write ${metadataTarget}: ${(err as Error).message}\n`,
					);
					return { outcome: "error", message: "write-failed" };
				}
			}
		}
	} else {
		stderr(`${tag} (skipped) skill file (--mcp-only)\n`);
	}

	// 3. MCP register.
	if (!cmd.skillsOnly) {
		// 3a. Claude needs probe+remove dance for idempotency.
		if (plan.target === "claude-code" && plan.listArgs && plan.removeArgs) {
			if (cmd.dryRun) {
				stderr(`${tag} (dry-run) probe: ${formatArgv(plan.cli, plan.listArgs)}\n`);
			} else {
				const list = await deps.spawner(plan.cli, plan.listArgs);
				if (list.code !== 0) {
					stderr(
						`${tag} error: ${plan.cli} ${plan.listArgs.join(" ")} failed: ${list.stderr.trim() || list.stdout.trim()}\n`,
					);
					return { outcome: "error", message: "host-cli-failed" };
				}
				if (claudeMcpListContains(list.stdout, cmd.mcpName)) {
					stderr(
						`${tag} mcp remove (existing): ${formatArgv(plan.cli, plan.removeArgs)}\n`,
					);
					const removed = await deps.spawner(plan.cli, plan.removeArgs);
					if (removed.code !== 0 && !isNotFoundStderr(removed.stderr)) {
						stderr(
							`${tag} error: ${formatArgv(plan.cli, plan.removeArgs)} failed: ${removed.stderr.trim() || removed.stdout.trim()}\n`,
						);
						return { outcome: "error", message: "host-cli-failed" };
					}
				}
			}
		}

		// 3b. The actual mcp add.
		if (cmd.dryRun) {
			stderr(`${tag} (dry-run) mcp register: ${formatArgv(plan.cli, plan.mcpAddArgs)}\n`);
		} else {
			stderr(`${tag} mcp register: ${formatArgv(plan.cli, plan.mcpAddArgs)}\n`);
			const added = await deps.spawner(plan.cli, plan.mcpAddArgs);
			if (added.code !== 0) {
				stderr(
					`${tag} error: ${formatArgv(plan.cli, plan.mcpAddArgs)} failed: ${added.stderr.trim() || added.stdout.trim()}\n`,
				);
				return { outcome: "error", message: "host-cli-failed" };
			}
		}
	} else {
		stderr(`${tag} (skipped) mcp register (--skills-only)\n`);
	}

	stderr(`${tag} ok\n`);
	return { outcome: "ok" };
};

export const runInstall = async (cmd: InstallCommand, deps: InstallDeps): Promise<number> => {
	const skillSourcePath = path.join(deps.packageRoot, "skills", cmd.mcpName, "SKILL.md");
	const skillMetadataSourcePath = path.join(
		deps.packageRoot,
		"skills",
		cmd.mcpName,
		"agents",
		"openai.yaml",
	);
	let skillSource: string;
	try {
		skillSource = await fs.readFile(skillSourcePath, "utf8");
	} catch {
		deps.stderr(`skill source not found at ${skillSourcePath}\n`);
		return 2;
	}
	let skillMetadataSource: string | null = null;
	try {
		skillMetadataSource = await fs.readFile(skillMetadataSourcePath, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			deps.stderr(`skill metadata unreadable at ${skillMetadataSourcePath}\n`);
			return 2;
		}
	}

	const serverBin =
		cmd.serverBin ?? path.join(deps.packageRoot, "dist", "bin", "veche-server.js");
	if (!path.isAbsolute(serverBin)) {
		deps.stderr(`--server-bin must be an absolute path\n`);
		return 64;
	}
	try {
		await fs.access(serverBin);
	} catch {
		deps.stderr(`server bin not found at ${serverBin}\n`);
		return 2;
	}

	const targets = expandTargets(cmd.target);
	for (const target of targets) {
		const plan = buildHostPlan(target, deps, cmd.mcpName, serverBin);
		const result = await runHost(plan, cmd, skillSource, skillMetadataSource, deps);
		if (result.outcome === "error") {
			return 2;
		}
	}

	deps.stderr("done.\n");
	return 0;
};

export const buildRealInstallDeps = (stderr: (s: string) => void): InstallDeps => ({
	stderr,
	env: process.env,
	homedir: () => os.homedir(),
	packageRoot: findPackageRoot(import.meta.url),
	spawner: realSpawner,
});
