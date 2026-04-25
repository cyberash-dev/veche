import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
	CancelJobUseCase,
	EndMeetingUseCase,
	GetResponseUseCase,
	GetTranscriptUseCase,
	ListMeetingsUseCase,
	SendMessageUseCase,
	StartMeetingUseCase,
} from "../../../features/meeting/index.js";
import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import { asJobId, asMeetingId } from "../../../shared/types/ids.js";
import { toMcpError } from "./errorMapping.js";
import {
	cancelJobSchema,
	endMeetingSchema,
	getResponseSchema,
	getTranscriptSchema,
	listMeetingsSchema,
	sendMessageSchema,
	startMeetingSchema,
} from "./schemas.js";

interface VecheDeps {
	readonly logger: LoggerPort;
	readonly startMeeting: StartMeetingUseCase;
	readonly sendMessage: SendMessageUseCase;
	readonly getResponse: GetResponseUseCase;
	readonly listMeetings: ListMeetingsUseCase;
	readonly getTranscript: GetTranscriptUseCase;
	readonly endMeeting: EndMeetingUseCase;
	readonly cancelJob: CancelJobUseCase;
}

const textResult = (
	payload: unknown,
): {
	content: Array<{ type: "text"; text: string }>;
} => ({
	content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

const errorResult = (
	err: unknown,
): {
	content: Array<{ type: "text"; text: string }>;
	isError: true;
} => {
	const mapped = toMcpError(err);
	return {
		content: [{ type: "text", text: JSON.stringify(mapped, null, 2) }],
		isError: true,
	};
};

export class VecheMcpServer {
	private readonly server: McpServer;

	constructor(private readonly deps: VecheDeps) {
		this.server = new McpServer(
			{ name: "veche-server", version: "0.1.0" },
			{ capabilities: { tools: {} } },
		);
		this.registerTools();
	}

	async connect(): Promise<void> {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		this.deps.logger.info("mcp.connected", {});
	}

	async close(): Promise<void> {
		await this.server.close();
	}

	private registerTools(): void {
		const {
			startMeeting,
			sendMessage,
			getResponse,
			listMeetings,
			getTranscript,
			endMeeting,
			cancelJob,
		} = this.deps;

		this.server.registerTool(
			"start_meeting",
			{
				description:
					"Create a new committee meeting with a facilitator and one or more LLM members.",
				inputSchema: startMeetingSchema,
			},
			async (args) => {
				try {
					const members = args.members.map((m) => ({
						id: m.id,
						...(m.profile !== undefined ? { profile: m.profile } : {}),
						...(m.adapter !== undefined ? { adapter: m.adapter } : {}),
						...(m.model !== undefined ? { model: m.model } : {}),
						...(m.systemPrompt !== undefined ? { systemPrompt: m.systemPrompt } : {}),
						...(m.workdir !== undefined ? { workdir: m.workdir } : {}),
						...(m.extraFlags !== undefined ? { extraFlags: m.extraFlags } : {}),
						...(m.env !== undefined ? { env: m.env } : {}),
					}));
					const facilitator = args.facilitator
						? {
								...(args.facilitator.id !== undefined
									? { id: args.facilitator.id }
									: {}),
								...(args.facilitator.displayName !== undefined
									? { displayName: args.facilitator.displayName }
									: {}),
							}
						: undefined;
					const result = await startMeeting.execute({
						title: args.title,
						...(facilitator !== undefined ? { facilitator } : {}),
						members,
						...(args.defaultMaxRounds !== undefined
							? { defaultMaxRounds: args.defaultMaxRounds }
							: {}),
					});
					return textResult(result);
				} catch (err) {
					return errorResult(err);
				}
			},
		);

		this.server.registerTool(
			"send_message",
			{
				description:
					"Post a facilitator message and start a committee discussion job. Non-blocking: returns a jobId; poll get_response to consume the transcript delta.",
				inputSchema: sendMessageSchema,
			},
			async (args) => {
				try {
					const result = await sendMessage.execute({
						meetingId: asMeetingId(args.meetingId),
						text: args.text,
						...(args.maxRounds !== undefined ? { maxRounds: args.maxRounds } : {}),
						...(args.turnTimeoutMs !== undefined
							? { turnTimeoutMs: args.turnTimeoutMs }
							: {}),
						...(args.addressees !== undefined ? { addressees: args.addressees } : {}),
					});
					return textResult(result);
				} catch (err) {
					return errorResult(err);
				}
			},
		);

		this.server.registerTool(
			"get_response",
			{
				description:
					"Poll a job: returns status, termination reason, and a transcript delta since the cursor. waitMs allows blocking up to 60s for new events.",
				inputSchema: getResponseSchema,
			},
			async (args) => {
				try {
					const result = await getResponse.execute({
						jobId: asJobId(args.jobId),
						...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
						...(args.limit !== undefined ? { limit: args.limit } : {}),
						...(args.waitMs !== undefined ? { waitMs: args.waitMs } : {}),
					});
					return textResult(result);
				} catch (err) {
					return errorResult(err);
				}
			},
		);

		this.server.registerTool(
			"list_meetings",
			{
				description:
					"List meetings with optional status/time filters. Default returns active meetings.",
				inputSchema: listMeetingsSchema,
			},
			async (args) => {
				try {
					const result = await listMeetings.execute({
						...(args.status !== undefined ? { status: args.status } : {}),
						...(args.createdAfter !== undefined
							? { createdAfter: args.createdAfter }
							: {}),
						...(args.createdBefore !== undefined
							? { createdBefore: args.createdBefore }
							: {}),
						...(args.limit !== undefined ? { limit: args.limit } : {}),
						...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
					});
					return textResult(result);
				} catch (err) {
					return errorResult(err);
				}
			},
		);

		this.server.registerTool(
			"get_transcript",
			{
				description: "Read a Meeting transcript since an optional cursor. Non-blocking.",
				inputSchema: getTranscriptSchema,
			},
			async (args) => {
				try {
					const result = await getTranscript.execute({
						meetingId: asMeetingId(args.meetingId),
						...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
						...(args.limit !== undefined ? { limit: args.limit } : {}),
					});
					return textResult(result);
				} catch (err) {
					return errorResult(err);
				}
			},
		);

		this.server.registerTool(
			"end_meeting",
			{
				description:
					"Close a Meeting. Fails with MeetingBusy when a Job is in-flight unless cancelRunningJob=true.",
				inputSchema: endMeetingSchema,
			},
			async (args) => {
				try {
					const result = await endMeeting.execute({
						meetingId: asMeetingId(args.meetingId),
						...(args.cancelRunningJob !== undefined
							? { cancelRunningJob: args.cancelRunningJob }
							: {}),
					});
					return textResult(result);
				} catch (err) {
					return errorResult(err);
				}
			},
		);

		this.server.registerTool(
			"cancel_job",
			{
				description: "Abort an in-flight Job. Graceful first, forced after 30s.",
				inputSchema: cancelJobSchema,
			},
			async (args) => {
				try {
					const result = await cancelJob.execute({
						jobId: asJobId(args.jobId),
						...(args.reason !== undefined ? { reason: args.reason } : {}),
					});
					return textResult(result);
				} catch (err) {
					return errorResult(err);
				}
			},
		);
	}
}
