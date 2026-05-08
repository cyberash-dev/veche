export interface PassClassification {
	readonly kind: "speech" | "pass";
	readonly text: string;
}

const PASS_TOKEN = "<PASS/>";

/**
 * Deterministic classifier per spec/spec.md.
 * A response counts as `pass` only when, stripped of whitespace, it equals exactly `<PASS/>`.
 */
export const classifyResponse = (raw: string): PassClassification => {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return { kind: "speech", text: "" };
	}
	const stripped = trimmed.replace(/\s+/g, "");
	if (stripped === PASS_TOKEN) {
		return { kind: "pass", text: PASS_TOKEN };
	}
	return { kind: "speech", text: trimmed };
};

export const PASS_PROTOCOL_SUFFIX = [
	"TERMINATION PROTOCOL — read first.",
	"You are one of several agents in a committee discussion. Each Round you",
	"either contribute substantive new content OR you end your participation",
	"for that Round by replying with the SINGLE token <PASS/> and nothing else.",
	"There is no third option. Polite goodbyes, acknowledgements, summaries,",
	"or any prose alongside <PASS/> are classified as speech and PREVENT the",
	"meeting from terminating. The discussion ends only when every active",
	"member has replied with the bare token <PASS/> in the same Round, so",
	"please use <PASS/> as soon as you have nothing more to add.",
].join("\n");

/**
 * One-line termination reminder prepended to every per-Turn prompt by
 * DispatchTurnUseCase (committee-protocol:BEH-001 step 4a). It exists because
 * the system prompt carrying PASS_PROTOCOL_SUFFIX is sent only on Turn 1, and
 * by Round 3+ the instruction often decays out of the resumed CLI session's
 * working context. The reminder is intentionally a single line: cheap in
 * tokens, hard to miss in the per-turn payload.
 */
export const PASS_PROTOCOL_REMINDER =
	"[reminder] If you have nothing substantive to add this round, reply with the single token <PASS/> on its own — anything else (including polite farewells) is treated as speech and prevents the meeting from ending.";
