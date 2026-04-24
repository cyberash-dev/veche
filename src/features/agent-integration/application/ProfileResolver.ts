import type { AdapterKind } from "../../meeting/domain/Participant.js";
import {
	AdapterFlagNotAllowed,
	ProfileAdapterMismatch,
	ProfileNotFound,
} from "../domain/errors.js";
import type { Profile, UserConfigFile } from "../domain/Profile.js";

export interface ResolvedParticipantConfig {
	readonly adapter: AdapterKind;
	readonly profile: string | null;
	readonly systemPrompt: string | null;
	readonly model: string | null;
	readonly workdir: string | null;
	readonly extraFlags: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

export interface MemberInput {
	readonly profile?: string;
	readonly adapter?: AdapterKind;
	readonly systemPrompt?: string;
	readonly model?: string;
	readonly workdir?: string;
	readonly extraFlags?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
}

const ALLOW_LISTS: Record<AdapterKind, readonly RegExp[]> = {
	"codex-cli": [
		/^--sandbox$/,
		/^workspace-write$/,
		/^danger-full-access$/,
		/^read-only$/,
		/^--profile$/,
		/^[a-zA-Z0-9_.-]+$/,
		/^--ephemeral$/,
		/^--skip-git-repo-check$/,
	],
	"claude-code-cli": [
		/^--allowedTools$/,
		/^--append-system-prompt$/,
		/^--max-budget-usd$/,
		/^--effort$/,
		/^low$|^medium$|^high$|^xhigh$|^max$/,
		/^--agent$/,
		/^--setting-sources$/,
		/^--verbose$/,
		/^--no-session-persistence$/,
		/^[0-9]+(\.[0-9]+)?$/, // numbers for --max-budget-usd
		/^[a-zA-Z0-9_,.:-]+$/, // generic string for list/agent values
	],
};

const ALLOWED_FLAG = (adapter: AdapterKind, value: string): boolean =>
	ALLOW_LISTS[adapter].some((re) => re.test(value));

export class ProfileResolver {
	constructor(private readonly config: UserConfigFile | null) {}

	resolve(input: MemberInput): ResolvedParticipantConfig {
		let profile: Profile | null = null;
		if (input.profile !== undefined) {
			profile = this.config?.profiles.find((p) => p.name === input.profile) ?? null;
			if (!profile) {
				throw new ProfileNotFound(input.profile);
			}
			if (input.adapter && input.adapter !== profile.adapter) {
				throw new ProfileAdapterMismatch(input.profile, input.adapter, profile.adapter);
			}
		}
		const adapter: AdapterKind | undefined = input.adapter ?? profile?.adapter;
		if (!adapter) {
			throw new ProfileNotFound("(missing adapter and profile)");
		}
		const extraFlags = input.extraFlags ?? profile?.extraFlags ?? [];
		for (const flag of extraFlags) {
			if (!ALLOWED_FLAG(adapter, flag)) {
				throw new AdapterFlagNotAllowed(adapter, flag);
			}
		}
		return {
			adapter,
			profile: input.profile ?? null,
			systemPrompt: input.systemPrompt ?? profile?.systemPrompt ?? null,
			model: input.model ?? profile?.model ?? null,
			workdir: input.workdir ?? profile?.workdir ?? null,
			extraFlags,
			env: { ...(profile?.env ?? {}), ...(input.env ?? {}) },
		};
	}
}
