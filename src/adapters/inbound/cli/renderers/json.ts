import type { Renderer } from "./types.js";

export const renderJson: Renderer = (input) => {
	const payload = {
		meeting: input.meeting,
		participants: input.participants,
		jobs: input.jobs,
		messages: input.messages,
		events: input.events,
		generatedAt: input.generatedAt,
		generator: { name: "ai-meeting", version: input.version },
	};
	return `${JSON.stringify(payload, null, 2)}\n`;
};
