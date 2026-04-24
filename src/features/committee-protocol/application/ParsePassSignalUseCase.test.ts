import { describe, expect, it } from "vitest";
import { ParsePassSignalUseCase } from "./ParsePassSignalUseCase.js";

describe("ParsePassSignalUseCase", () => {
	const uc = new ParsePassSignalUseCase();

	it("treats exact token as pass", () => {
		expect(uc.execute("<PASS/>").kind).toBe("pass");
	});

	it("tolerates surrounding whitespace for pass", () => {
		expect(uc.execute("   <PASS/>\n").kind).toBe("pass");
		expect(uc.execute("\t<PASS/>\t").kind).toBe("pass");
	});

	it("treats mixed content with token as speech", () => {
		const r = uc.execute("<PASS/> I disagree");
		expect(r.kind).toBe("speech");
		expect(r.text).toContain("<PASS/>");
	});

	it("is case-sensitive", () => {
		expect(uc.execute("<pass/>").kind).toBe("speech");
	});

	it("empty string is speech with empty text", () => {
		expect(uc.execute("").kind).toBe("speech");
		expect(uc.execute("").text).toBe("");
	});

	it("normal text is speech", () => {
		const r = uc.execute("hello world");
		expect(r.kind).toBe("speech");
		expect(r.text).toBe("hello world");
	});
});
