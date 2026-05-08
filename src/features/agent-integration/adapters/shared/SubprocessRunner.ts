import { type ChildProcess, spawn } from "node:child_process";

/**
 * Raised when the OS refuses to launch the binary with EPERM/EACCES.
 * Adapters classify this as `*-spawn-blocked` (retryable=false) — typically
 * surfaces when veche runs under a host sandbox that blocks nested CLI spawns
 * (Codex CLI on Windows is the known case; see issue #3).
 */
export class SpawnBlockedError extends Error {
	readonly errno: string;

	constructor(errno: string, cause: Error) {
		super(`spawn blocked by OS (errno ${errno}): ${cause.message}`);
		this.name = "SpawnBlockedError";
		this.errno = errno;
		this.cause = cause;
	}
}

const isSpawnBlocked = (err: unknown): err is NodeJS.ErrnoException => {
	if (!(err instanceof Error)) {
		return false;
	}
	const code = (err as NodeJS.ErrnoException).code;
	return code === "EPERM" || code === "EACCES";
};

export interface SpawnOptions {
	readonly bin: string;
	readonly args: readonly string[];
	readonly env: NodeJS.ProcessEnv;
	readonly cwd?: string;
	readonly timeoutMs: number;
	readonly cancellationSignal: AbortSignal;
	readonly onStderrLine?: (line: string) => void;
}

export interface SpawnOutcome {
	readonly code: number | null;
	readonly signal: NodeJS.Signals | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly timedOut: boolean;
	readonly cancelled: boolean;
	readonly durationMs: number;
}

const TERM_GRACE_MS = 2000;

export const runSubprocess = async (opts: SpawnOptions): Promise<SpawnOutcome> => {
	const start = Date.now();
	return new Promise<SpawnOutcome>((resolve, reject) => {
		let child: ChildProcess;
		try {
			child = spawn(opts.bin, [...opts.args], {
				env: opts.env,
				...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (err) {
			if (isSpawnBlocked(err)) {
				reject(new SpawnBlockedError(err.code as string, err));
			} else {
				reject(err);
			}
			return;
		}

		let stdout = "";
		let stderr = "";
		let stderrBuffer = "";
		let timedOut = false;
		let cancelled = false;

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
			if (opts.onStderrLine) {
				stderrBuffer += chunk;
				let idx = stderrBuffer.indexOf("\n");
				while (idx !== -1) {
					opts.onStderrLine(stderrBuffer.slice(0, idx));
					stderrBuffer = stderrBuffer.slice(idx + 1);
					idx = stderrBuffer.indexOf("\n");
				}
			}
		});

		const killEscalating = (): void => {
			if (child.exitCode !== null || child.signalCode) {
				return;
			}
			child.kill("SIGTERM");
			setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) {
					child.kill("SIGKILL");
				}
			}, TERM_GRACE_MS).unref();
		};

		const timeoutTimer = setTimeout(() => {
			timedOut = true;
			killEscalating();
		}, opts.timeoutMs);
		timeoutTimer.unref();

		const onAbort = (): void => {
			cancelled = true;
			killEscalating();
		};
		if (opts.cancellationSignal.aborted) {
			onAbort();
		} else {
			opts.cancellationSignal.addEventListener("abort", onAbort, { once: true });
		}

		child.on("error", (err) => {
			clearTimeout(timeoutTimer);
			opts.cancellationSignal.removeEventListener("abort", onAbort);
			if (stderrBuffer && opts.onStderrLine) {
				opts.onStderrLine(stderrBuffer);
			}
			if (isSpawnBlocked(err)) {
				reject(new SpawnBlockedError((err as NodeJS.ErrnoException).code as string, err));
			} else {
				reject(err);
			}
		});
		child.on("close", (code, signal) => {
			clearTimeout(timeoutTimer);
			opts.cancellationSignal.removeEventListener("abort", onAbort);
			if (stderrBuffer && opts.onStderrLine) {
				opts.onStderrLine(stderrBuffer);
			}
			resolve({
				code,
				signal,
				stdout,
				stderr,
				timedOut,
				cancelled,
				durationMs: Date.now() - start,
			});
		});
	});
};
