import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildHostSpawner, quoteWindowsArg, type RawSpawnFn } from "../hostSpawner.js";

interface RawSpawnCall {
	readonly command: string;
	readonly args: readonly string[];
	readonly options: SpawnOptions;
}

const makeFakeChild = (exitCode: number, stdoutChunk = "", stderrChunk = ""): ChildProcess => {
	const make = (chunk: string) =>
		({
			setEncoding: () => undefined,
			on: (event: string, cb: (c: string) => void) => {
				if (event === "data" && chunk) {
					queueMicrotask(() => cb(chunk));
				}
				return undefined;
			},
		}) as unknown as ChildProcess["stdout"];

	const child = {
		stdout: make(stdoutChunk),
		stderr: make(stderrChunk),
		on: (event: string, cb: (...args: unknown[]) => void) => {
			if (event === "close") {
				queueMicrotask(() => cb(exitCode));
			}
			return child;
		},
	} as unknown as ChildProcess;

	return child;
};

const makeFakeRawSpawn = (
	calls: RawSpawnCall[],
	exitCode = 0,
	stdoutChunk = "",
	stderrChunk = "",
): RawSpawnFn => {
	return (command: string, args: readonly string[], options: SpawnOptions) => {
		calls.push({ command, args: [...args], options });
		return makeFakeChild(exitCode, stdoutChunk, stderrChunk);
	};
};

const makeErrorRawSpawn = (calls: RawSpawnCall[], errCode: string, message: string): RawSpawnFn => {
	return (command: string, args: readonly string[], options: SpawnOptions) => {
		calls.push({ command, args: [...args], options });
		const child = {
			stdout: { setEncoding: () => undefined, on: () => undefined },
			stderr: { setEncoding: () => undefined, on: () => undefined },
			on: (event: string, cb: (err: NodeJS.ErrnoException) => void) => {
				if (event === "error") {
					const err = new Error(message) as NodeJS.ErrnoException;
					err.code = errCode;
					queueMicrotask(() => cb(err));
				}
				return child;
			},
		} as unknown as ChildProcess;
		return child;
	};
};

describe("buildHostSpawner", () => {
	it("returns missing=true when which resolves to null", async () => {
		const calls: RawSpawnCall[] = [];
		const spawner = buildHostSpawner({
			platform: "linux",
			which: async () => null,
			rawSpawn: makeFakeRawSpawn(calls),
		});

		const result = await spawner("codex", ["--version"]);

		expect(result.missing).toBe(true);
		expect(calls).toHaveLength(0);
	});

	it("on linux spawns the resolved binary directly with the original args", async () => {
		const calls: RawSpawnCall[] = [];
		const spawner = buildHostSpawner({
			platform: "linux",
			which: async () => "/usr/local/bin/codex",
			rawSpawn: makeFakeRawSpawn(calls),
		});

		await spawner("codex", ["--version"]);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toBe("/usr/local/bin/codex");
		expect(calls[0]?.args).toEqual(["--version"]);
		expect(calls[0]?.options.shell).toBeFalsy();
	});

	it("on win32 launches a .cmd wrapper via cmd.exe /d /s /c with verbatim args", async () => {
		const calls: RawSpawnCall[] = [];
		const spawner = buildHostSpawner({
			platform: "win32",
			which: async () => "C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd",
			rawSpawn: makeFakeRawSpawn(calls),
		});

		await spawner("codex", ["mcp", "add", "veche"]);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toBe("cmd.exe");
		expect(calls[0]?.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
		expect(calls[0]?.options.windowsVerbatimArguments).toBe(true);
		const tail = calls[0]?.args.slice(3).join(" ") ?? "";
		expect(tail).toContain("codex.cmd");
		expect(tail).toContain("mcp");
		expect(tail).toContain("add");
		expect(tail).toContain("veche");
	});

	it("on win32 spawns a .exe directly without shell", async () => {
		const calls: RawSpawnCall[] = [];
		const spawner = buildHostSpawner({
			platform: "win32",
			which: async () => "C:\\tools\\codex.exe",
			rawSpawn: makeFakeRawSpawn(calls),
		});

		await spawner("codex", ["--version"]);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toBe("C:\\tools\\codex.exe");
		expect(calls[0]?.args).toEqual(["--version"]);
		expect(calls[0]?.options.shell).toBeFalsy();
	});

	it("classifies a spawn-time error on a resolved path as not-missing", async () => {
		const calls: RawSpawnCall[] = [];
		const spawner = buildHostSpawner({
			platform: "win32",
			which: async () => "C:\\bad\\codex.cmd",
			rawSpawn: makeErrorRawSpawn(calls, "EINVAL", "spawn EINVAL"),
		});

		const result = await spawner("codex", ["--version"]);

		expect(result.missing).toBe(false);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("spawn EINVAL");
	});
});

describe("quoteWindowsArg", () => {
	it("wraps simple args in double quotes", () => {
		expect(quoteWindowsArg("foo")).toBe('"foo"');
	});

	it("escapes embedded double quotes", () => {
		expect(quoteWindowsArg('a"b')).toBe('"a\\"b"');
	});

	it("doubles trailing backslashes before the closing quote", () => {
		expect(quoteWindowsArg("path\\")).toBe('"path\\\\"');
	});

	it("preserves spaces inside the quoted form", () => {
		expect(quoteWindowsArg("with spaces")).toBe('"with spaces"');
	});
});
