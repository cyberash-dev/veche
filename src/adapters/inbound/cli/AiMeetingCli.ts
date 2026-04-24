import type { MeetingStorePort } from "../../../features/persistence/ports/MeetingStorePort.js";
import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import { type ListCommand, runList } from "./commands/list.js";
import { runShow, type ShowCommand } from "./commands/show.js";

export interface CliDeps {
	readonly store: MeetingStorePort;
	readonly clock: ClockPort;
	readonly version: string;
	readonly argv: readonly string[];
	readonly stdout: (s: string) => void;
	readonly stderr: (s: string) => void;
}

const USAGE = `usage: ai-meeting <command> [flags]

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

  global:
    --home=<path>              override $AI_MEETING_HOME
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
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i]!;
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
			if (parsed.positional.length !== 1) {
				stderr(`show: expected exactly one <meetingId>\n`);
				return EXIT_USAGE;
			}
			const meetingId = parsed.positional[0]!;
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
		default: {
			stderr(`unknown command: ${sub}\n${USAGE}`);
			return EXIT_USAGE;
		}
	}
};
