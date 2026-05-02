import type { IncomingMessage, ServerResponse } from "node:http";
import {
	HumanTurnAlreadySubmitted,
	HumanTurnNotFound,
} from "../../../features/meeting/domain/errors.js";
import type {
	SetHumanParticipationUseCase,
	SubmitHumanTurnUseCase,
} from "../../../features/meeting/index.js";
import { asJobId, asMeetingId } from "../../../shared/types/ids.js";
import { writeJson } from "./MeetingsApi.js";

const MAX_BODY_BYTES = 32 * 1024;

const readJson = async (request: IncomingMessage): Promise<unknown> =>
	new Promise((resolve, reject) => {
		let raw = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			raw += chunk;
			if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
				reject(new Error("body too large"));
				request.destroy();
			}
		});
		request.on("end", () => {
			try {
				resolve(raw.length === 0 ? {} : JSON.parse(raw));
			} catch {
				reject(new Error("invalid json"));
			}
		});
		request.on("error", reject);
	});

const objectBody = (body: unknown): Record<string, unknown> | null =>
	typeof body === "object" && body !== null && !Array.isArray(body)
		? (body as Record<string, unknown>)
		: null;

export const handleSubmitHumanTurn = async (
	submitHumanTurn: SubmitHumanTurnUseCase,
	request: IncomingMessage,
	meetingId: string,
	response: ServerResponse,
): Promise<void> => {
	try {
		const body = objectBody(await readJson(request));
		if (body === null) {
			writeJson(response, 400, { error: "invalid body" });
			return;
		}
		if (
			typeof body.jobId !== "string" ||
			typeof body.requestId !== "string" ||
			(body.action !== "agree" && body.action !== "skip" && body.action !== "steer")
		) {
			writeJson(response, 400, { error: "invalid human turn payload" });
			return;
		}
		const result = await submitHumanTurn.execute({
			jobId: asJobId(body.jobId),
			requestId: body.requestId,
			action: body.action,
			...(typeof body.targetParticipantId === "string"
				? { targetParticipantId: body.targetParticipantId }
				: {}),
			...(body.strength === 1 || body.strength === 2 || body.strength === 3
				? { strength: body.strength }
				: {}),
			...(typeof body.text === "string" ? { text: body.text } : {}),
		});
		void meetingId;
		writeJson(response, 200, result);
	} catch (err) {
		if (err instanceof HumanTurnAlreadySubmitted || err instanceof HumanTurnNotFound) {
			writeJson(response, 409, { error: "human turn conflict" });
			return;
		}
		writeJson(response, 400, { error: (err as Error).message });
	}
};

export const handleSetHumanParticipation = async (
	setHumanParticipation: SetHumanParticipationUseCase,
	request: IncomingMessage,
	meetingId: string,
	response: ServerResponse,
): Promise<void> => {
	try {
		const body = objectBody(await readJson(request));
		if (
			body === null ||
			typeof body.participantId !== "string" ||
			typeof body.enabled !== "boolean"
		) {
			writeJson(response, 400, { error: "invalid participation payload" });
			return;
		}
		const result = await setHumanParticipation.execute({
			meetingId: asMeetingId(meetingId),
			participantId: body.participantId,
			enabled: body.enabled,
			...(typeof body.jobId === "string" ? { jobId: asJobId(body.jobId) } : {}),
		});
		writeJson(response, 200, result);
	} catch (err) {
		writeJson(response, 400, { error: (err as Error).message });
	}
};
