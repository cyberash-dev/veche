import { z } from "zod";

export const startMeetingSchema = {
	title: z.string().min(1).max(200),
	facilitator: z
		.object({
			id: z
				.string()
				.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/)
				.optional(),
			displayName: z.string().min(1).max(64).optional(),
		})
		.optional(),
	members: z
		.array(
			z.object({
				id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/),
				profile: z.string().optional(),
				adapter: z.enum(["codex-cli", "claude-code-cli"]).optional(),
				model: z.string().min(1).optional(),
				systemPrompt: z.string().optional(),
				workdir: z.string().optional(),
				extraFlags: z.array(z.string()).max(16).optional(),
				env: z.record(z.string(), z.string()).optional(),
			}),
		)
		.min(1)
		.max(8),
	defaultMaxRounds: z.number().int().min(1).optional(),
};

export const sendMessageSchema = {
	meetingId: z.string().min(1),
	text: z.string().min(1),
	maxRounds: z.number().int().min(1).optional(),
	turnTimeoutMs: z.number().int().min(10_000).max(3_600_000).optional(),
	addressees: z.array(z.string()).optional(),
};

export const getResponseSchema = {
	jobId: z.string().min(1),
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(500).optional(),
	waitMs: z.number().int().min(0).max(60_000).optional(),
};

export const listMeetingsSchema = {
	status: z.enum(["active", "ended", "all"]).optional(),
	createdAfter: z.string().optional(),
	createdBefore: z.string().optional(),
	limit: z.number().int().min(1).max(100).optional(),
	cursor: z.string().optional(),
};

export const getTranscriptSchema = {
	meetingId: z.string().min(1),
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(500).optional(),
};

export const endMeetingSchema = {
	meetingId: z.string().min(1),
	cancelRunningJob: z.boolean().optional(),
};

export const cancelJobSchema = {
	jobId: z.string().min(1),
	reason: z.string().min(1).max(200).optional(),
};
