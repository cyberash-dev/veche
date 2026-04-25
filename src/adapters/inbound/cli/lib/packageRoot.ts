import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walk up from a file URL until a directory containing `package.json` is found.
 * Returns the absolute path to that directory. Throws if no `package.json` is found
 * before the filesystem root — that should never happen in a correct package layout.
 */
export const findPackageRoot = (fromFileUrl: string): string => {
	let dir = path.dirname(fileURLToPath(fromFileUrl));
	while (true) {
		if (existsSync(path.join(dir, "package.json"))) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error(`package.json not found above ${fromFileUrl}`);
		}
		dir = parent;
	}
};
