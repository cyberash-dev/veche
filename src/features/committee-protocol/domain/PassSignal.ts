export interface PassClassification {
	readonly kind: "speech" | "pass";
	readonly text: string;
}

const PASS_TOKEN = "<PASS/>";

/**
 * Deterministic classifier per spec/features/committee-protocol/parse-pass-signal.usecase.md.
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
	"You are one of several agents participating in a committee discussion.",
	"Each round you receive prior messages from other agents. You may reply",
	"with new substantive content or, if you have nothing more to add, reply",
	"with exactly the token <PASS/> on a line by itself with no other characters.",
	"Mixed content that contains <PASS/> alongside other text is treated as a",
	"normal reply; the pass is only recognised when your response consists",
	"solely of <PASS/>.",
].join("\n");
