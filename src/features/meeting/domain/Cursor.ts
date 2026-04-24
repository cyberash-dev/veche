export interface CursorValue {
	readonly seq: number;
	readonly byteOffset?: number;
}

export type Cursor = string;

export const encodeCursor = (value: CursorValue): Cursor =>
	Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

export const decodeCursor = (raw: string): CursorValue => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
	} catch {
		throw new Error("CursorInvalid: cannot decode");
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("CursorInvalid: not an object");
	}
	const seq = (parsed as { seq?: unknown }).seq;
	if (typeof seq !== "number" || !Number.isInteger(seq) || seq < -1) {
		throw new Error("CursorInvalid: bad seq");
	}
	const byteOffset = (parsed as { byteOffset?: unknown }).byteOffset;
	if (byteOffset !== undefined && (typeof byteOffset !== "number" || byteOffset < 0)) {
		throw new Error("CursorInvalid: bad byteOffset");
	}
	return byteOffset === undefined ? { seq } : { seq, byteOffset };
};

export const INITIAL_CURSOR: CursorValue = { seq: -1 };
