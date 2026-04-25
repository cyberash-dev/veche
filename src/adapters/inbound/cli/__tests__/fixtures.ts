import type { Job } from "../../../../features/meeting/domain/Job.js";
import type { Meeting } from "../../../../features/meeting/domain/Meeting.js";
import type { Message } from "../../../../features/meeting/domain/Message.js";
import type { Participant } from "../../../../features/meeting/domain/Participant.js";
import {
	asJobId,
	asMeetingId,
	asMessageId,
	asParticipantId,
	asSessionId,
} from "../../../../shared/types/ids.js";
import { asInstant } from "../../../../shared/types/instant.js";
import type { RenderInput } from "../renderers/types.js";

const INSTANT = asInstant("2026-04-24T10:00:00.000Z");

export const fixtureInput = (overrides: Partial<RenderInput> = {}): RenderInput => {
	const meetingId = asMeetingId("fixture-meeting-1");
	const meeting: Meeting = {
		id: meetingId,
		title: "tabs vs spaces for new CLI",
		status: "ended",
		createdAt: INSTANT,
		endedAt: asInstant("2026-04-24T10:05:00.000Z"),
		participants: [],
		defaultMaxRounds: 3,
	};
	const facilitator: Participant = {
		id: asParticipantId("facilitator"),
		role: "facilitator",
		displayName: "facilitator",
		adapter: null,
		profile: null,
		systemPrompt: null,
		workdir: null,
		model: null,
		extraFlags: [],
		env: {},
		sessionId: null,
		providerRef: null,
		status: "active",
		droppedAt: null,
		droppedReason: null,
	};
	const codex: Participant = {
		...facilitator,
		id: asParticipantId("codex"),
		role: "member",
		displayName: "codex",
		adapter: "codex-cli",
		sessionId: asSessionId("00000000-0000-4000-8000-000000000001"),
	};
	const claude: Participant = {
		...facilitator,
		id: asParticipantId("claude"),
		role: "member",
		displayName: "claude",
		adapter: "claude-code-cli",
		sessionId: asSessionId("00000000-0000-4000-8000-000000000002"),
	};
	const job: Job = {
		id: asJobId("fixture-job-1"),
		meetingId,
		status: "completed",
		createdAt: INSTANT,
		startedAt: INSTANT,
		finishedAt: asInstant("2026-04-24T10:05:00.000Z"),
		maxRounds: 3,
		turnTimeoutMs: 120_000,
		addressees: null,
		lastSeq: 7,
		rounds: 2,
		terminationReason: "all-passed",
		error: null,
		cancelReason: null,
	};
	const messages: Message[] = [
		{
			id: asMessageId("m-0"),
			meetingId,
			seq: 3,
			round: 0,
			author: asParticipantId("facilitator"),
			kind: "speech",
			text: "Should we use tabs or spaces? <one word>",
			createdAt: INSTANT,
		},
		{
			id: asMessageId("m-1"),
			meetingId,
			seq: 5,
			round: 1,
			author: asParticipantId("codex"),
			kind: "speech",
			text: "spaces",
			createdAt: INSTANT,
		},
		{
			id: asMessageId("m-2"),
			meetingId,
			seq: 6,
			round: 1,
			author: asParticipantId("claude"),
			kind: "speech",
			text: "spaces — it's the ecosystem default.",
			createdAt: INSTANT,
		},
		{
			id: asMessageId("m-3"),
			meetingId,
			seq: 7,
			round: 2,
			author: asParticipantId("codex"),
			kind: "pass",
			text: "<PASS/>",
			createdAt: INSTANT,
		},
		{
			id: asMessageId("m-4"),
			meetingId,
			seq: 8,
			round: 2,
			author: asParticipantId("claude"),
			kind: "pass",
			text: "<PASS/>",
			createdAt: INSTANT,
		},
	];
	return {
		meeting,
		participants: [facilitator, codex, claude],
		jobs: [job],
		messages,
		events: null,
		generatedAt: asInstant("2026-04-24T11:00:00.000Z"),
		useColor: false,
		version: "0.1.0",
		...overrides,
	};
};
