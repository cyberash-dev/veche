import type { AdapterKind } from "../../meeting/domain/Participant.js";

export interface Profile {
	readonly name: string;
	readonly adapter: AdapterKind;
	readonly model: string | null;
	readonly systemPrompt: string | null;
	readonly workdir: string | null;
	readonly extraFlags: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

export interface UserConfigFile {
	readonly version: 1;
	readonly profiles: readonly Profile[];
}
