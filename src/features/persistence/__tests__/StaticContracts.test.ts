import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const partitionRoot = path.join(repoRoot, "src", "features", "persistence");

const FORBIDDEN_STORAGE_LIBS = [
	"level",
	"levelup",
	"leveldown",
	"sqlite3",
	"better-sqlite3",
	"lmdb",
	"redis",
	"ioredis",
	"pg",
	"mysql",
	"mysql2",
	"mongodb",
	"mongoose",
	"sequelize",
	"typeorm",
	"prisma",
	"@prisma/client",
	"knex",
];

const FORBIDDEN_LOCK_LIBS = [
	"proper-lockfile",
	"lockfile",
	"@npmcli/fs",
	"async-lock",
	"fs-ext",
	"flock",
];

async function walkTs(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const out: string[] = [];
	for (const e of entries) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) {
			out.push(...(await walkTs(p)));
		} else if (e.isFile() && p.endsWith(".ts")) {
			out.push(p);
		}
	}
	return out;
}

describe("persistence static contracts", () => {
	// @covers persistence:CST-001
	it("does not depend on any third-party storage library", async () => {
		const pkgRaw = await readFile(path.join(repoRoot, "package.json"), "utf8");
		const pkg = JSON.parse(pkgRaw) as {
			dependencies?: Record<string, string>;
			optionalDependencies?: Record<string, string>;
		};
		const runtime = {
			...(pkg.dependencies ?? {}),
			...(pkg.optionalDependencies ?? {}),
		};
		for (const banned of FORBIDDEN_STORAGE_LIBS) {
			expect(Object.keys(runtime), `runtime dependency ${banned} is forbidden`).not.toContain(
				banned,
			);
		}

		const files = await walkTs(partitionRoot);
		for (const f of files) {
			if (f.endsWith(".test.ts")) {
				continue;
			}
			const src = await readFile(f, "utf8");
			for (const banned of FORBIDDEN_STORAGE_LIBS) {
				const re = new RegExp(`from\\s+["']${banned.replace(/[/]/g, "\\/")}["']`);
				expect(src, `${path.relative(repoRoot, f)} imports ${banned}`).not.toMatch(re);
			}
		}
	});

	// @covers persistence:CST-002
	it("does not use any cross-process file-lock primitive", async () => {
		const pkgRaw = await readFile(path.join(repoRoot, "package.json"), "utf8");
		const pkg = JSON.parse(pkgRaw) as { dependencies?: Record<string, string> };
		const runtime = pkg.dependencies ?? {};
		for (const banned of FORBIDDEN_LOCK_LIBS) {
			expect(Object.keys(runtime), `runtime dependency ${banned} is forbidden`).not.toContain(
				banned,
			);
		}

		const files = await walkTs(partitionRoot);
		const forbiddenSubstrings = [
			'from "proper-lockfile"',
			"from 'proper-lockfile'",
			'from "lockfile"',
			"from 'lockfile'",
			"fs.flock",
			"fcntl",
		];
		for (const f of files) {
			if (f.endsWith(".test.ts")) {
				continue;
			}
			const src = await readFile(f, "utf8");
			for (const banned of forbiddenSubstrings) {
				expect(
					src,
					`${path.relative(repoRoot, f)} contains forbidden ${banned}`,
				).not.toContain(banned);
			}
		}
	});
});
