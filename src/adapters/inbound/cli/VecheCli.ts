import type { MeetingStorePort } from "../../../features/persistence/ports/MeetingStorePort.js";
import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import {
	buildRealInstallDeps,
	type InstallCommand,
	type InstallTargetSelection,
	MCP_NAME_RE,
	runInstall,
} from "./commands/install.js";
import { type ListCommand, runList } from "./commands/list.js";
import { runShow, type ShowCommand } from "./commands/show.js";
import { runWatch, type WatchCommand } from "./commands/watch.js";

export interface CliDeps {
	readonly store: MeetingStorePort;
	readonly clock: ClockPort;
	readonly logger: LoggerPort;
	readonly version: string;
	readonly argv: readonly string[];
	readonly stdout: (s: string) => void;
	readonly stderr: (s: string) => void;
}

const USAGE = `usage: veche <command> [flags]

commands:
  list                         enumerate meetings
    --status=active|ended|all  (default: active)
    --limit=N                  1..100 (default: 50)
    --format=text|json         (default: text)
    --no-color

  show <meetingId>             render a full transcript
    --format=text|html|json|markdown  (default: text)
    --out=<path|->             write to file (atomic); "-" or absent → stdout
    --open                     (html only) write to tmp and open in browser
    --raw                      include every event type, not just speech/pass/system
    --no-color

  watch                        start a local web viewer (live SPA + SSE)
    --port=N                   0..65535 (default: 0 — kernel-assigned ephemeral)
    --host=HOST                bind address (default: 127.0.0.1)
    --no-open                  do not auto-open the browser
    --no-color

  install                      install the veche skill + register MCP server
    --for=claude-code|codex|both  (default: both)
    --mcp-name=NAME            MCP server + skill directory name (default: veche)
    --server-bin=<abs path>    override path to veche-server.js
    --skills-only              only copy SKILL.md, skip MCP register
    --mcp-only                 only register MCP, skip SKILL.md copy
    --skip-config              skip seeding $VECHE_HOME/config.json
    --force                    proceed past missing host CLIs; overwrite existing config.json
    --dry-run                  print actions without performing them
    --no-color

  global:
    --home=<path>              override $VECHE_HOME
    --help, -h                 show this help
`;

const EXIT_USAGE = 64;

interface ParsedFlags {
	readonly positional: string[];
	readonly flags: Map<string, string | true>;
}

const parseFlags = (argv: readonly string[]): ParsedFlags => {
	const positional: string[] = [];
	const flags = new Map<string, string | true>();
	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];
		if (arg === undefined) {
			break;
		}
		if (arg === "--") {
			positional.push(...argv.slice(i + 1));
			break;
		}
		if (arg.startsWith("--")) {
			const eq = arg.indexOf("=");
			if (eq >= 0) {
				flags.set(arg.slice(2, eq), arg.slice(eq + 1));
			} else {
				// space-separated value only when the next arg is not another flag.
				const next = argv[i + 1];
				if (next !== undefined && !next.startsWith("-")) {
					flags.set(arg.slice(2), next);
					i += 1;
				} else {
					flags.set(arg.slice(2), true);
				}
			}
		} else if (arg === "-h") {
			flags.set("help", true);
		} else {
			positional.push(arg);
		}
		i += 1;
	}
	return { positional, flags };
};

const readStringFlag = (
	flags: Map<string, string | true>,
	name: string,
	fallback: string,
): string => {
	const v = flags.get(name);
	if (v === true) {
		throw new Error(`flag --${name} requires a value`);
	}
	return v ?? fallback;
};

const readIntFlag = (flags: Map<string, string | true>, name: string, fallback: number): number => {
	const v = flags.get(name);
	if (v === undefined) {
		return fallback;
	}
	if (v === true) {
		throw new Error(`flag --${name} requires a value`);
	}
	const n = Number.parseInt(v, 10);
	if (!Number.isFinite(n)) {
		throw new Error(`flag --${name} must be an integer`);
	}
	return n;
};

const useColorFrom = (flags: Map<string, string | true>): boolean => {
	if (flags.has("no-color")) {
		return false;
	}
	if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
		return false;
	}
	return process.stdout.isTTY === true;
};

export const runCli = async (deps: CliDeps): Promise<number> => {
	const { argv, stderr } = deps;
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
		stderr(USAGE);
		return argv.length === 0 ? EXIT_USAGE : 0;
	}
	const [sub, ...rest] = argv;
	let parsed: ParsedFlags;
	try {
		parsed = parseFlags(rest);
	} catch (err) {
		stderr(`${(err as Error).message}\n${USAGE}`);
		return EXIT_USAGE;
	}
	if (parsed.flags.get("help") === true) {
		stderr(USAGE);
		return 0;
	}

	switch (sub) {
		case "list": {
			const status = readStringFlag(parsed.flags, "status", "active");
			if (status !== "active" && status !== "ended" && status !== "all") {
				stderr(`invalid --status: ${status}\n`);
				return EXIT_USAGE;
			}
			const limit = readIntFlag(parsed.flags, "limit", 50);
			if (limit < 1 || limit > 100) {
				stderr(`--limit must be 1..100\n`);
				return EXIT_USAGE;
			}
			const format = readStringFlag(parsed.flags, "format", "text");
			if (format !== "text" && format !== "json") {
				stderr(`invalid --format for list: ${format}\n`);
				return EXIT_USAGE;
			}
			const cmd: ListCommand = {
				status,
				limit,
				format,
				useColor: useColorFrom(parsed.flags),
			};
			return runList(cmd, {
				store: deps.store,
				clock: deps.clock,
				stdout: deps.stdout,
				stderr: deps.stderr,
			});
		}
		case "show": {
			const meetingId = parsed.positional[0];
			if (parsed.positional.length !== 1 || meetingId === undefined) {
				stderr(`show: expected exactly one <meetingId>\n`);
				return EXIT_USAGE;
			}
			const format = readStringFlag(parsed.flags, "format", "text");
			if (
				format !== "text" &&
				format !== "html" &&
				format !== "json" &&
				format !== "markdown"
			) {
				stderr(`invalid --format for show: ${format}\n`);
				return EXIT_USAGE;
			}
			const outRaw = parsed.flags.get("out");
			const out = typeof outRaw === "string" ? outRaw : null;
			const open = parsed.flags.get("open") === true;
			if (open && format !== "html") {
				stderr(`--open requires --format=html\n`);
				return EXIT_USAGE;
			}
			if (open && out !== null && out !== "-") {
				stderr(`--open and --out=<path> are mutually exclusive\n`);
				return EXIT_USAGE;
			}
			const raw = parsed.flags.get("raw") === true;
			const cmd: ShowCommand = {
				meetingId,
				format,
				out,
				open,
				raw,
				useColor: useColorFrom(parsed.flags),
			};
			return runShow(cmd, {
				store: deps.store,
				clock: deps.clock,
				version: deps.version,
				stdout: deps.stdout,
				stderr: deps.stderr,
			});
		}
		case "watch": {
			if (parsed.positional.length !== 0) {
				stderr(`watch: takes no positional arguments\n`);
				return EXIT_USAGE;
			}
			const port = readIntFlag(parsed.flags, "port", 0);
			if (!Number.isInteger(port) || port < 0 || port > 65535) {
				stderr(`--port must be 0..65535\n`);
				return EXIT_USAGE;
			}
			const host = readStringFlag(parsed.flags, "host", "127.0.0.1");
			if (host === "") {
				stderr(`--host must not be empty\n`);
				return EXIT_USAGE;
			}
			const noOpen = parsed.flags.get("no-open") === true;
			const cmd: WatchCommand = {
				host,
				port,
				noOpen,
				useColor: useColorFrom(parsed.flags),
			};
			return runWatch(cmd, {
				store: deps.store,
				clock: deps.clock,
				logger: deps.logger,
				version: deps.version,
				stderr: deps.stderr,
			});
		}
		case "install": {
			if (parsed.positional.length !== 0) {
				stderr(`install: takes no positional arguments\n`);
				return EXIT_USAGE;
			}
			const target = readStringFlag(parsed.flags, "for", "both");
			if (target !== "claude-code" && target !== "codex" && target !== "both") {
				stderr(`invalid --for: ${target}\n`);
				return EXIT_USAGE;
			}
			const mcpName = readStringFlag(parsed.flags, "mcp-name", "veche");
			if (!MCP_NAME_RE.test(mcpName)) {
				stderr(`invalid --mcp-name: ${mcpName}\n`);
				return EXIT_USAGE;
			}
			const serverBinRaw = parsed.flags.get("server-bin");
			const serverBin =
				typeof serverBinRaw === "string" && serverBinRaw.length > 0 ? serverBinRaw : null;
			const skillsOnly = parsed.flags.get("skills-only") === true;
			const mcpOnly = parsed.flags.get("mcp-only") === true;
			if (skillsOnly && mcpOnly) {
				stderr(`--skills-only and --mcp-only are mutually exclusive\n`);
				return EXIT_USAGE;
			}
			const skipConfig = parsed.flags.get("skip-config") === true;
			const homeRaw = parsed.flags.get("home");
			const homeOverride = typeof homeRaw === "string" && homeRaw.length > 0 ? homeRaw : null;
			const cmd: InstallCommand = {
				target: target as InstallTargetSelection,
				mcpName,
				serverBin,
				skillsOnly,
				mcpOnly,
				skipConfig,
				homeOverride,
				force: parsed.flags.get("force") === true,
				dryRun: parsed.flags.get("dry-run") === true,
				useColor: useColorFrom(parsed.flags),
			};
			return runInstall(cmd, buildRealInstallDeps(deps.stderr));
		}
		default: {
			stderr(`unknown command: ${sub}\n${USAGE}`);
			return EXIT_USAGE;
		}
	}
};
