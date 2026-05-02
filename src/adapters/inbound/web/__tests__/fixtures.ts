import type { Meeting } from "../../../../features/meeting/domain/Meeting.js";
import {
	DEFAULT_FACILITATOR_DISCUSSION_ROLE,
	DEFAULT_MODEL_DISCUSSION_ROLE,
	type Participant,
} from "../../../../features/meeting/domain/Participant.js";
import { InMemoryMeetingStore } from "../../../../features/persistence/adapters/in-memory/InMemoryMeetingStore.js";
import { asMeetingId, asMessageId, asParticipantId } from "../../../../shared/types/ids.js";
import { asInstant } from "../../../../shared/types/instant.js";
import { FakeClock } from "../../../../test-utils/FakeClock.js";

export interface SeedResult {
	readonly store: InMemoryMeetingStore;
	readonly clock: FakeClock;
	readonly meetingId: ReturnType<typeof asMeetingId>;
}

export const buildMeeting = (id: string, title: string, clock: FakeClock): Meeting => ({
	id: asMeetingId(id),
	title,
	status: "active",
	createdAt: clock.now(),
	endedAt: null,
	participants: [],
	defaultMaxRounds: 3,
});

export const buildFacilitator = (id: string): Participant => ({
	id: asParticipantId(id),
	role: "facilitator",
	participantKind: "human",
	discussionRole: DEFAULT_FACILITATOR_DISCUSSION_ROLE,
	isHumanParticipationEnabled: false,
	displayName: id,
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
});

export const buildMember = (id: string): Participant => ({
	...buildFacilitator(id),
	role: "member",
	participantKind: "model",
	discussionRole: DEFAULT_MODEL_DISCUSSION_ROLE,
	isHumanParticipationEnabled: false,
	adapter: "codex-cli",
});

export const seedMeeting = async (
	storeOverride?: InMemoryMeetingStore,
	clockOverride?: FakeClock,
): Promise<SeedResult> => {
	const clock = clockOverride ?? new FakeClock();
	const store = storeOverride ?? new InMemoryMeetingStore(clock);
	const meeting = buildMeeting("m-watch", "Live demo meeting", clock);
	const facilitator = buildFacilitator("alice");
	const member = buildMember("bob");
	await store.createMeeting({ meeting, participants: [facilitator, member] });
	await store.appendMessage({
		meetingId: meeting.id,
		jobId: null,
		message: {
			id: asMessageId("seed-1"),
			round: 0,
			author: facilitator.id,
			kind: "speech",
			text: "Opening question",
			createdAt: asInstant("2026-04-25T10:00:00.000Z"),
		},
	});
	return { store, clock, meetingId: meeting.id };
};

export const appendMember = async (
	store: InMemoryMeetingStore,
	meetingId: ReturnType<typeof asMeetingId>,
	speaker: string,
	text: string,
	round: number,
	id: string,
): Promise<void> => {
	await store.appendMessage({
		meetingId,
		jobId: null,
		message: {
			id: asMessageId(id),
			round,
			author: asParticipantId(speaker),
			kind: "speech",
			text,
			createdAt: asInstant(`2026-04-25T10:0${round}:00.000Z`),
		},
	});
};
