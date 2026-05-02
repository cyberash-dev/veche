import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type InstallCommand,
	type InstallDeps,
	runInstall,
	type SpawnFn,
	type SpawnResult,
} from "../install.js";

interface SpawnCall {
	readonly command: string;
	readonly args: readonly string[];
}

interface FakeSpawnerSetup {
	readonly spawner: SpawnFn;
	readonly calls: SpawnCall[];
	respond(matcher: (call: SpawnCall) => boolean, result: Partial<SpawnResult>): void;
}

const fakeSpawner = (defaults?: Partial<SpawnResult>): FakeSpawnerSetup => {
	const calls: SpawnCall[] = [];
	const overrides: Array<{
		match: (call: SpawnCall) => boolean;
		result: Partial<SpawnResult>;
	}> = [];
	const baseDefault: SpawnResult = {
		code: 0,
		stdout: "",
		stderr: "",
		missing: false,
		...defaults,
	};
	const spawner: SpawnFn = async (command, args) => {
		const call: SpawnCall = { command, args: [...args] };
		calls.push(call);
		for (const override of overrides) {
			if (override.match(call)) {
				return { ...baseDefault, ...override.result };
			}
		}
		return baseDefault;
	};
	return {
		spawner,
		calls,
		respond(match, result) {
			overrides.push({ match, result });
		},
	};
};

const buildDeps = async (
	overrides: Partial<InstallDeps> = {},
): Promise<{ deps: InstallDeps; root: string; home: string; stderr: () => string }> => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "veche-pkg-"));
	const home = await fs.mkdtemp(path.join(os.tmpdir(), "veche-home-"));
	await fs.mkdir(path.join(root, "skills", "veche"), { recursive: true });
	await fs.writeFile(
		path.join(root, "skills", "veche", "SKILL.md"),
		"---\nname: veche\n---\nbody\n",
	);
	await fs.mkdir(path.join(root, "skills", "veche", "agents"), { recursive: true });
	await fs.writeFile(
		path.join(root, "skills", "veche", "agents", "openai.yaml"),
		'interface:\n  display_name: "Veche"\n',
	);
	await fs.mkdir(path.join(root, "dist", "bin"), { recursive: true });
	await fs.writeFile(path.join(root, "dist", "bin", "veche-server.js"), "// stub");
	let stderrBuffer = "";
	const deps: InstallDeps = {
		stderr: (s: string) => {
			stderrBuffer += s;
		},
		env: {},
		homedir: () => home,
		packageRoot: root,
		spawner: fakeSpawner().spawner,
		...overrides,
	};
	return { deps, root, home, stderr: () => stderrBuffer };
};

const baseCommand = (): InstallCommand => ({
	target: "both",
	mcpName: "veche",
	serverBin: null,
	skillsOnly: false,
	mcpOnly: false,
	force: false,
	dryRun: false,
	useColor: false,
});

const tmpDirs: string[] = [];

afterEach(async () => {
	while (tmpDirs.length > 0) {
		const dir = tmpDirs.pop();
		if (dir !== undefined) {
			await fs.rm(dir, { recursive: true, force: true });
		}
	}
});

describe("runInstall", () => {
	let spawn: FakeSpawnerSetup;
	let depsHandle: { deps: InstallDeps; root: string; home: string; stderr: () => string };

	beforeEach(async () => {
		spawn = fakeSpawner();
		depsHandle = await buildDeps({ spawner: spawn.spawner });
		tmpDirs.push(depsHandle.root, depsHandle.home);
	});

	it("writes SKILL.md and registers both hosts on default flags", async () => {
		const code = await runInstall(baseCommand(), depsHandle.deps);
		expect(code).toBe(0);

		const claudeSkill = path.join(depsHandle.home, ".claude", "skills", "veche", "SKILL.md");
		const codexSkill = path.join(depsHandle.home, ".codex", "skills", "veche", "SKILL.md");
		const codexMetadata = path.join(
			depsHandle.home,
			".codex",
			"skills",
			"veche",
			"agents",
			"openai.yaml",
		);
		expect(await fs.readFile(claudeSkill, "utf8")).toContain("name: veche");
		expect(await fs.readFile(codexSkill, "utf8")).toContain("name: veche");
		expect(await fs.readFile(codexMetadata, "utf8")).toContain('display_name: "Veche"');

		const claudeAdd = spawn.calls.find(
			(c) => c.command === "claude" && c.args[0] === "mcp" && c.args[1] === "add",
		);
		expect(claudeAdd).toBeDefined();
		expect(claudeAdd?.args).toContain("--scope");
		expect(claudeAdd?.args[claudeAdd.args.length - 1]).toBe(
			path.join(depsHandle.root, "dist", "bin", "veche-server.js"),
		);

		const codexAdd = spawn.calls.find(
			(c) => c.command === "codex" && c.args[0] === "mcp" && c.args[1] === "add",
		);
		expect(codexAdd).toBeDefined();
	});

	it("removes existing claude entry before re-adding (idempotency)", async () => {
		spawn.respond(
			(c) => c.command === "claude" && c.args[0] === "mcp" && c.args[1] === "list",
			{ stdout: "veche: node /old/path.js\nfoo: bar\n" },
		);
		const code = await runInstall({ ...baseCommand(), target: "claude-code" }, depsHandle.deps);
		expect(code).toBe(0);
		const removeCall = spawn.calls.find(
			(c) => c.command === "claude" && c.args[0] === "mcp" && c.args[1] === "remove",
		);
		expect(removeCall).toBeDefined();
	});

	it("does not call mcp remove when claude has no entry yet", async () => {
		spawn.respond(
			(c) => c.command === "claude" && c.args[0] === "mcp" && c.args[1] === "list",
			{ stdout: "foo: bar\n" },
		);
		const code = await runInstall({ ...baseCommand(), target: "claude-code" }, depsHandle.deps);
		expect(code).toBe(0);
		const removeCall = spawn.calls.find(
			(c) => c.command === "claude" && c.args[0] === "mcp" && c.args[1] === "remove",
		);
		expect(removeCall).toBeUndefined();
	});

	it("returns 2 when host CLI is missing without --force", async () => {
		spawn.respond((c) => c.command === "claude" && c.args[0] === "--version", {
			missing: true,
			code: -1,
		});
		const code = await runInstall({ ...baseCommand(), target: "claude-code" }, depsHandle.deps);
		expect(code).toBe(2);
		expect(depsHandle.stderr()).toContain("not found on PATH");
	});

	it("continues past missing host CLI with --force", async () => {
		spawn.respond((c) => c.command === "claude" && c.args[0] === "--version", {
			missing: true,
			code: -1,
		});
		const code = await runInstall(
			{ ...baseCommand(), target: "both", force: true },
			depsHandle.deps,
		);
		expect(code).toBe(0);
		const stderr = depsHandle.stderr();
		expect(stderr).toContain("[claude-code] skipped");
		expect(stderr).toContain("[codex] ok");
	});

	it("returns 2 when claude mcp add fails", async () => {
		spawn.respond((c) => c.command === "claude" && c.args[0] === "mcp" && c.args[1] === "add", {
			code: 1,
			stderr: "boom\n",
		});
		const code = await runInstall({ ...baseCommand(), target: "claude-code" }, depsHandle.deps);
		expect(code).toBe(2);
		expect(depsHandle.stderr()).toContain("boom");
	});

	it("--skills-only does not spawn mcp add", async () => {
		const code = await runInstall(
			{ ...baseCommand(), target: "claude-code", skillsOnly: true },
			depsHandle.deps,
		);
		expect(code).toBe(0);
		const addCall = spawn.calls.find((c) => c.command === "claude" && c.args[1] === "add");
		expect(addCall).toBeUndefined();
	});

	it("--mcp-only does not write SKILL.md", async () => {
		const code = await runInstall(
			{ ...baseCommand(), target: "claude-code", mcpOnly: true },
			depsHandle.deps,
		);
		expect(code).toBe(0);
		const claudeSkill = path.join(depsHandle.home, ".claude", "skills", "veche", "SKILL.md");
		await expect(fs.access(claudeSkill)).rejects.toBeTruthy();
	});

	it("succeeds when optional UI metadata is absent", async () => {
		await fs.rm(path.join(depsHandle.root, "skills", "veche", "agents"), {
			recursive: true,
			force: true,
		});
		const code = await runInstall({ ...baseCommand(), target: "codex" }, depsHandle.deps);
		expect(code).toBe(0);

		const codexSkill = path.join(depsHandle.home, ".codex", "skills", "veche", "SKILL.md");
		const codexMetadata = path.join(
			depsHandle.home,
			".codex",
			"skills",
			"veche",
			"agents",
			"openai.yaml",
		);
		expect(await fs.readFile(codexSkill, "utf8")).toContain("name: veche");
		await expect(fs.access(codexMetadata)).rejects.toBeTruthy();
	});

	it("--dry-run does not write or spawn", async () => {
		const code = await runInstall({ ...baseCommand(), dryRun: true }, depsHandle.deps);
		expect(code).toBe(0);
		expect(spawn.calls).toHaveLength(0);
		const claudeSkill = path.join(depsHandle.home, ".claude", "skills", "veche", "SKILL.md");
		await expect(fs.access(claudeSkill)).rejects.toBeTruthy();
		expect(depsHandle.stderr()).toContain("(dry-run)");
	});

	it("returns 2 when skill source is missing", async () => {
		await fs.rm(path.join(depsHandle.deps.packageRoot, "skills"), { recursive: true });
		const code = await runInstall(baseCommand(), depsHandle.deps);
		expect(code).toBe(2);
		expect(depsHandle.stderr()).toContain("skill source not found");
	});

	it("returns 2 when --server-bin does not exist", async () => {
		const code = await runInstall(
			{ ...baseCommand(), serverBin: "/no/such/file.js" },
			depsHandle.deps,
		);
		expect(code).toBe(2);
		expect(depsHandle.stderr()).toContain("server bin not found");
	});

	it("returns 64 when --server-bin is not absolute", async () => {
		const code = await runInstall(
			{ ...baseCommand(), serverBin: "relative/path.js" },
			depsHandle.deps,
		);
		expect(code).toBe(64);
	});

	it("respects CLAUDE_BIN and CODEX_BIN env overrides", async () => {
		const handle = await buildDeps({
			spawner: spawn.spawner,
			env: { CLAUDE_BIN: "/custom/claude", CODEX_BIN: "/custom/codex" },
		});
		tmpDirs.push(handle.root, handle.home);
		const code = await runInstall(baseCommand(), handle.deps);
		expect(code).toBe(0);
		const claudeCall = spawn.calls.find((c) => c.command === "/custom/claude");
		expect(claudeCall).toBeDefined();
		const codexCall = spawn.calls.find((c) => c.command === "/custom/codex");
		expect(codexCall).toBeDefined();
	});

	it("never writes outside the host skills root", async () => {
		// Successful run; the skill file paths must be under home/.claude or home/.codex.
		await runInstall(baseCommand(), depsHandle.deps);
		const findFiles = async (dir: string, acc: string[] = []): Promise<string[]> => {
			let entries: import("node:fs").Dirent[];
			try {
				entries = await fs.readdir(dir, { withFileTypes: true });
			} catch {
				return acc;
			}
			for (const entry of entries) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await findFiles(full, acc);
				} else {
					acc.push(full);
				}
			}
			return acc;
		};
		const written = await findFiles(depsHandle.home);
		for (const file of written) {
			const claudeRoot = path.join(depsHandle.home, ".claude", "skills", "veche");
			const codexRoot = path.join(depsHandle.home, ".codex", "skills", "veche");
			expect(file.startsWith(claudeRoot) || file.startsWith(codexRoot)).toBe(true);
		}
	});
});
