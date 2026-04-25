import type { MeetingStorePort } from "../../../../features/persistence/ports/MeetingStorePort.js";
import type { ClockPort } from "../../../../shared/ports/ClockPort.js";
import { ansi, truncate } from "../renderers/helpers.js";

export interface ListCommand {
	readonly status: "active" | "ended" | "all";
	readonly limit: number;
	readonly format: "text" | "json";
	readonly useColor: boolean;
}

export interface ListDeps {
	readonly store: MeetingStorePort;
	readonly clock: ClockPort;
	readonly stdout: (s: string) => void;
	readonly stderr: (s: string) => void;
}

export const runList = async (cmd: ListCommand, deps: ListDeps): Promise<number> => {
	const { store, stdout, stderr } = deps;
	const filter: Parameters<MeetingStorePort["listMeetings"]>[0] = {
		limit: cmd.limit,
		...(cmd.status === "all" ? {} : { status: cmd.status }),
	};
	const result = await store.listMeetings(filter);
	if (cmd.format === "json") {
		stdout(`${JSON.stringify(result, null, 2)}\n`);
		return 0;
	}

	if (result.summaries.length === 0) {
		const note =
			cmd.status === "active"
				? "no active meetings; try --status all\n"
				: `no meetings found (filter: status=${cmd.status})\n`;
		stderr(note);
		return 0;
	}

	const c = ansi(cmd.useColor);
	const rows = result.summaries.map((s) => ({
		id: truncate(s.meetingId, 14),
		title: truncate(s.title, 32),
		status: s.status,
		created: s.createdAt,
		members: String(s.participants.filter((p) => p.role === "member").length),
		open: String(s.openJobCount),
	}));
	const cols = ["ID", "TITLE", "STATUS", "CREATED (UTC)", "MEMBERS", "OPEN"] as const;
	const wId = Math.max(cols[0].length, ...rows.map((r) => r.id.length));
	const wTitle = Math.max(cols[1].length, ...rows.map((r) => r.title.length));
	const wStatus = Math.max(cols[2].length, ...rows.map((r) => r.status.length));
	const wCreated = Math.max(cols[3].length, ...rows.map((r) => r.created.length));
	const wMembers = Math.max(cols[4].length, ...rows.map((r) => r.members.length));
	const wOpen = Math.max(cols[5].length, ...rows.map((r) => r.open.length));
	const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - s.length));
	const header = [
		pad(cols[0], wId),
		pad(cols[1], wTitle),
		pad(cols[2], wStatus),
		pad(cols[3], wCreated),
		pad(cols[4], wMembers),
		pad(cols[5], wOpen),
	].join("  ");
	stdout(`${c.bold(header)}\n`);
	for (const r of rows) {
		const status =
			r.status === "active"
				? c.green(pad(r.status, wStatus))
				: c.grey(pad(r.status, wStatus));
		const open = r.open === "0" ? c.dim(pad(r.open, wOpen)) : c.bold(pad(r.open, wOpen));
		stdout(
			`${[
				pad(r.id, wId),
				pad(r.title, wTitle),
				status,
				pad(r.created, wCreated),
				pad(r.members, wMembers),
				open,
			].join("  ")}\n`,
		);
	}
	stderr(
		`${c.dim(
			`${result.summaries.length} meetings shown (filter: status=${cmd.status})${
				result.nextCursor ? "; more available, pagination not exposed via CLI" : ""
			}`,
		)}\n`,
	);
	return 0;
};
