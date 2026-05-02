import type {
	HumanTurnView,
	SynthesisView,
} from "../../../features/meeting/application/humanTurnState.js";
import type { Job } from "../../../features/meeting/domain/Job.js";
import type { Meeting } from "../../../features/meeting/domain/Meeting.js";
import type { Message } from "../../../features/meeting/domain/Message.js";
import type {
	DiscussionRole,
	Participant,
	ParticipantKind,
} from "../../../features/meeting/domain/Participant.js";
import type {
	MeetingSnapshot,
	MeetingSummary,
} from "../../../features/persistence/ports/MeetingStorePort.js";
import { renderMarkdownToHtml } from "../../../shared/markdown/markdownToHtml.js";

export interface ParticipantDto {
	readonly id: string;
	readonly role: "facilitator" | "member";
	readonly participantKind: ParticipantKind;
	readonly discussionRole: DiscussionRole;
	readonly isHumanParticipationEnabled: boolean;
	readonly displayName: string;
	readonly adapter: "codex-cli" | "claude-code-cli" | null;
	readonly status: "active" | "dropped";
}

export interface SummaryParticipantDto {
	readonly id: string;
	readonly role: "facilitator" | "member";
	readonly participantKind: ParticipantKind;
	readonly adapter: "codex-cli" | "claude-code-cli" | null;
	readonly status: "active" | "dropped";
}

export interface MeetingDto {
	readonly id: string;
	readonly title: string;
	readonly status: "active" | "ended";
	readonly createdAt: string;
	readonly endedAt: string | null;
	readonly defaultMaxRounds: number;
}

export interface JobDto {
	readonly id: string;
	readonly meetingId: string;
	readonly status:
		| "queued"
		| "running"
		| "waiting_for_human"
		| "completed"
		| "failed"
		| "cancelled";
	readonly createdAt: string;
	readonly startedAt: string | null;
	readonly finishedAt: string | null;
	readonly maxRounds: number;
	readonly rounds: number;
	readonly lastSeq: number;
	readonly terminationReason: string | null;
	readonly error: { code: string; message: string } | null;
	readonly cancelReason: string | null;
}

export interface MessageDto {
	readonly id: string;
	readonly meetingId: string;
	readonly seq: number;
	readonly round: number;
	readonly author: string;
	readonly kind: "speech" | "pass" | "system";
	readonly text: string;
	/**
	 * Markdown-rendered HTML for `speech` messages, produced by the same escape-then-transform
	 * pipeline as `show --format=html`. `null` for `pass` and `system`.
	 */
	readonly htmlBody: string | null;
	readonly createdAt: string;
}

export interface SummaryDto {
	readonly meetingId: string;
	readonly title: string;
	readonly status: "active" | "ended";
	readonly createdAt: string;
	readonly endedAt: string | null;
	readonly participants: readonly SummaryParticipantDto[];
	readonly lastSeq: number;
	readonly openJobCount: number;
}

export interface SnapshotDto {
	readonly meeting: MeetingDto;
	readonly participants: readonly ParticipantDto[];
	readonly openJobs: readonly JobDto[];
	readonly lastSeq: number;
	readonly humanTurn: HumanTurnView | null;
	readonly synthesis: SynthesisView | null;
}

export const meetingDto = (meeting: Meeting): MeetingDto => ({
	id: meeting.id,
	title: meeting.title,
	status: meeting.status,
	createdAt: meeting.createdAt,
	endedAt: meeting.endedAt,
	defaultMaxRounds: meeting.defaultMaxRounds,
});

export const participantDto = (participant: Participant): ParticipantDto => ({
	id: participant.id,
	role: participant.role,
	participantKind: participant.participantKind,
	discussionRole: participant.discussionRole,
	isHumanParticipationEnabled: participant.isHumanParticipationEnabled,
	displayName: participant.displayName,
	adapter: participant.adapter,
	status: participant.status,
});

export const jobDto = (job: Job): JobDto => ({
	id: job.id,
	meetingId: job.meetingId,
	status: job.status,
	createdAt: job.createdAt,
	startedAt: job.startedAt,
	finishedAt: job.finishedAt,
	maxRounds: job.maxRounds,
	rounds: job.rounds,
	lastSeq: job.lastSeq,
	terminationReason: job.terminationReason,
	error: job.error,
	cancelReason: job.cancelReason,
});

export const messageDto = (message: Message): MessageDto => ({
	id: message.id,
	meetingId: message.meetingId,
	seq: message.seq,
	round: message.round,
	author: message.author,
	kind: message.kind,
	text: message.text,
	htmlBody: message.kind === "speech" ? renderMarkdownToHtml(message.text) : null,
	createdAt: message.createdAt,
});

export const summaryDto = (summary: MeetingSummary): SummaryDto => ({
	meetingId: summary.meetingId,
	title: summary.title,
	status: summary.status,
	createdAt: summary.createdAt,
	endedAt: summary.endedAt,
	participants: summary.participants.map((p) => ({
		id: p.id,
		role: p.role,
		participantKind: p.participantKind,
		adapter: p.adapter,
		status: p.status,
	})),
	lastSeq: summary.lastSeq,
	openJobCount: summary.openJobCount,
});

export const snapshotDto = (
	snapshot: MeetingSnapshot,
	extras: {
		readonly humanTurn?: HumanTurnView | null;
		readonly synthesis?: SynthesisView | null;
	} = {},
): SnapshotDto => ({
	meeting: meetingDto(snapshot.meeting),
	participants: snapshot.participants.map(participantDto),
	openJobs: snapshot.openJobs.map(jobDto),
	lastSeq: snapshot.lastSeq,
	humanTurn: extras.humanTurn ?? null,
	synthesis: extras.synthesis ?? null,
});
