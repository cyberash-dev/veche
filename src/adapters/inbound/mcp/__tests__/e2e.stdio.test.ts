import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(dirname, "../../../../../dist/bin/veche-server.js");

interface RpcResponse {
	id?: number;
	result?: unknown;
	error?: unknown;
}

const sendAndReceive = async (messages: readonly object[]): Promise<RpcResponse[]> => {
	const child = spawn(process.execPath, [binPath], {
		env: { ...process.env, VECHE_STORE: "memory", VECHE_LOG_LEVEL: "error" },
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		stdout += chunk;
	});
	child.stderr.on("data", () => {});
	for (const msg of messages) {
		child.stdin.write(`${JSON.stringify(msg)}\n`);
	}
	// Give the server a moment to respond.
	await new Promise((r) => setTimeout(r, 300));
	child.stdin.end();
	await new Promise<void>((resolve) => {
		child.on("close", () => resolve());
	});
	const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
	return lines.map((l) => JSON.parse(l) as RpcResponse);
};

describe("stdio MCP smoke", () => {
	it("lists tools after initialize", async () => {
		const responses = await sendAndReceive([
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "vitest", version: "0" },
				},
			},
			{ jsonrpc: "2.0", method: "notifications/initialized", params: {} },
			{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
		]);
		const initResp = responses.find((r) => r.id === 1);
		expect(initResp?.result).toMatchObject({ protocolVersion: "2024-11-05" });
		const listResp = responses.find((r) => r.id === 2);
		const list = listResp?.result as { tools: Array<{ name: string }> };
		const names = list.tools.map((t) => t.name).sort();
		expect(names).toEqual([
			"cancel_job",
			"end_meeting",
			"get_response",
			"get_transcript",
			"list_meetings",
			"send_message",
			"set_human_participation",
			"start_meeting",
			"submit_human_turn",
			"submit_synthesis",
		]);
	});
});
