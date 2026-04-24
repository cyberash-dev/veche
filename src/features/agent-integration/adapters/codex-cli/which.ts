import { access, constants } from "node:fs/promises";
import path from "node:path";

/**
 * Minimal `which`: returns an absolute executable path, or null if not found.
 * Accepts an absolute/relative path and returns it verbatim when it is accessible as a file.
 */
const which = async (command: string): Promise<string | null> => {
	if (!command) {
		return null;
	}
	if (command.includes(path.sep) || path.isAbsolute(command)) {
		try {
			await access(command, constants.X_OK);
			return command;
		} catch {
			return null;
		}
	}
	const pathEnv = process.env.PATH ?? "";
	const pathExt = process.platform === "win32" ? (process.env.PATHEXT ?? "").split(";") : [""];
	for (const dir of pathEnv.split(path.delimiter)) {
		if (!dir) {
			continue;
		}
		for (const ext of pathExt) {
			const candidate = path.join(dir, `${command}${ext}`);
			try {
				await access(candidate, constants.X_OK);
				return candidate;
			} catch {
				// ignore
			}
		}
	}
	return null;
};

export default which;
