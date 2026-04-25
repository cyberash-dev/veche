import { spawn } from "node:child_process";

export interface Opener {
	readonly bin: string;
	readonly args: readonly string[];
}

export const resolveOpener = (): Opener | null => {
	if (process.platform === "darwin") {
		return { bin: "open", args: [] };
	}
	if (process.platform === "win32") {
		return { bin: "cmd.exe", args: ["/c", "start", ""] };
	}
	return { bin: "xdg-open", args: [] };
};

export const openInBrowser = (target: string): "ok" | "no-opener" | "spawn-failed" => {
	const opener = resolveOpener();
	if (opener === null) {
		return "no-opener";
	}
	try {
		const child = spawn(opener.bin, [...opener.args, target], {
			detached: true,
			stdio: "ignore",
		});
		child.unref();
		return "ok";
	} catch {
		return "spawn-failed";
	}
};
