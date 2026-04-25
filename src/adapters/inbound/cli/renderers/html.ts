import type { Participant } from "../../../../features/meeting/domain/Participant.js";
import {
	escapeHtml,
	groupByRound,
	participantColor,
	renderMarkdownToHtml,
	truncate,
} from "./helpers.js";
import type { Renderer } from "./types.js";

const CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1a1a1a;
  background: #fafafa;
}
.container { max-width: 920px; margin: 0 auto; }
.card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 20px 24px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.03);
}
h1 { margin: 0 0 8px; font-size: 22px; }
h2 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
h3 { margin: 20px 0 12px; font-size: 15px; font-weight: 600; color: #4b5563; }
.meta { color: #6b7280; font-size: 13px; }
.meta code { background: #f3f4f6; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.pill {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.pill.active { background: #dcfce7; color: #166534; }
.pill.ended { background: #e5e7eb; color: #374151; }
.pill.completed { background: #dcfce7; color: #166534; }
.pill.failed { background: #fee2e2; color: #991b1b; }
.pill.cancelled { background: #fef3c7; color: #92400e; }
.pill.queued, .pill.running { background: #dbeafe; color: #1e40af; }
.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 6px;
  border: 1px solid rgba(0,0,0,0.08);
  vertical-align: middle;
}
.p-list { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.p-item { display: inline-flex; align-items: center; font-size: 13px; }
.p-item .role { color: #6b7280; margin-left: 6px; }
.p-item .dropped { color: #b91c1c; font-weight: 600; margin-left: 6px; }
.jobs-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.jobs-table th, .jobs-table td {
  text-align: left; padding: 6px 10px; border-bottom: 1px solid #f3f4f6;
}
.jobs-table th { color: #6b7280; font-weight: 500; }
.round { margin-top: 20px; }
.round-header { display: flex; align-items: center; gap: 12px; }
.round-header summary { cursor: pointer; font-weight: 600; color: #374151; }
.msg {
  display: flex;
  margin: 10px 0;
  gap: 10px;
}
.msg.right { flex-direction: row-reverse; }
.msg .author {
  font-size: 12px;
  color: #374151;
  font-weight: 600;
  margin-bottom: 2px;
}
.msg .author .time { font-weight: 400; color: #9ca3af; margin-left: 8px; }
.msg .bubble {
  border-radius: 14px;
  padding: 10px 14px;
  max-width: 72%;
  white-space: normal;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  border: 1px solid rgba(0,0,0,0.05);
}
.msg .bubble > p { margin: 0 0 8px; }
.msg .bubble > p:last-child { margin-bottom: 0; }
.msg .bubble strong { font-weight: 600; }
.msg .bubble em { font-style: italic; }
.msg .bubble code {
  background: rgba(0,0,0,0.06);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
}
.msg .bubble pre {
  background: rgba(0,0,0,0.06);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 8px 0;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.88em;
  white-space: pre;
}
.msg .bubble pre code { background: transparent; padding: 0; font-size: inherit; }
.msg .bubble ul, .msg .bubble ol { margin: 6px 0 6px 20px; padding: 0; }
.msg .bubble li { margin: 2px 0; }
.msg .bubble blockquote {
  margin: 6px 0;
  padding: 4px 10px;
  border-left: 3px solid rgba(0,0,0,0.15);
  color: #4b5563;
}
.msg .bubble h1, .msg .bubble h2, .msg .bubble h3 {
  margin: 8px 0 4px;
  font-weight: 600;
  line-height: 1.25;
}
.msg .bubble h1 { font-size: 1.15em; }
.msg .bubble h2 { font-size: 1.08em; }
.msg .bubble h3 { font-size: 1em; }
.msg .bubble hr { border: 0; border-top: 1px solid rgba(0,0,0,0.1); margin: 8px 0; }
.msg .bubble a { color: #1d4ed8; text-decoration: underline; }
.msg .bubble table {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 0.95em;
  background: rgba(255,255,255,0.5);
}
.msg .bubble th, .msg .bubble td {
  border: 1px solid rgba(0,0,0,0.12);
  padding: 4px 10px;
  text-align: left;
  vertical-align: top;
}
.msg .bubble th { background: rgba(0,0,0,0.04); font-weight: 600; }
.msg .col { display: flex; flex-direction: column; min-width: 0; }
.msg.right .col { align-items: flex-end; }
.pass {
  text-align: center;
  margin: 8px 0;
  color: #9ca3af;
  font-size: 12px;
}
.pass .chip {
  display: inline-block;
  padding: 2px 10px;
  background: #f3f4f6;
  border-radius: 999px;
  font-style: italic;
}
.system {
  margin: 14px 0;
  padding: 8px 12px;
  background: #fef3c7;
  border: 1px solid #fde68a;
  color: #78350f;
  border-radius: 8px;
  text-align: center;
  font-size: 13px;
}
.msg.facilitator { flex-direction: column; align-items: stretch; }
.msg.facilitator .col { align-items: stretch; }
.msg.facilitator .bubble {
  max-width: 100%;
  background: #ededed;
  border: 1px solid #d1d5db;
  font-style: italic;
}
.msg.facilitator .author { color: #6b7280; }
.peer-caption {
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
  font-style: italic;
}
.footer { color: #9ca3af; font-size: 12px; text-align: center; margin-top: 32px; }
details[open] summary::marker { color: #9ca3af; }
details { margin-top: 16px; border-top: 1px solid #f3f4f6; padding-top: 10px; }
`;

const statusClass = (status: string): string => {
	const known = new Set([
		"active",
		"ended",
		"completed",
		"failed",
		"cancelled",
		"queued",
		"running",
	]);
	return known.has(status) ? status : "queued";
};

/** Alternates members between left and right by their position among non-facilitator
 * participants. The facilitator is rendered separately as a centered, full-width bubble. */
const bubbleSide = (memberIndex: number): "left" | "right" =>
	memberIndex % 2 === 0 ? "left" : "right";

export const renderHtml: Renderer = (input) => {
	const { meeting, participants, jobs, messages, events, generatedAt, version } = input;
	const colorByParticipant = new Map<string, string>();
	const memberIndexByParticipant = new Map<string, number>();
	let memberCounter = 0;
	const memberCount = participants.filter((p) => p.role === "member").length;
	participants.forEach((p: Participant) => {
		colorByParticipant.set(p.id, participantColor(p));
		if (p.role === "member") {
			memberIndexByParticipant.set(p.id, memberCounter);
			memberCounter += 1;
		}
	});

	const out: string[] = [];
	out.push("<!DOCTYPE html>");
	out.push('<html lang="en">');
	out.push("<head>");
	out.push('<meta charset="utf-8">');
	out.push(
		'<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
	);
	out.push(`<title>${escapeHtml(`Veche · ${meeting.title}`)}</title>`);
	out.push("<style>");
	out.push(CSS);
	out.push("</style>");
	out.push("</head>");
	out.push('<body><div class="container">');

	// Header card
	out.push('<div class="card">');
	out.push(`<h1>${escapeHtml(meeting.title)}</h1>`);
	out.push(
		`<div class="meta">` +
			`<code>${escapeHtml(meeting.id)}</code> ` +
			`<span class="pill ${statusClass(meeting.status)}">${escapeHtml(meeting.status)}</span> ` +
			`· created <code>${escapeHtml(meeting.createdAt)}</code>` +
			(meeting.endedAt ? ` · ended <code>${escapeHtml(meeting.endedAt)}</code>` : "") +
			`</div>`,
	);
	out.push(`<h2 style="margin-top:16px">Participants</h2>`);
	out.push(
		`<div class="peer-caption">Symmetric peer deliberation — ${memberCount} member${
			memberCount === 1 ? "" : "s"
		} + 1 facilitator</div>`,
	);
	out.push('<div class="p-list">');
	for (const p of participants) {
		const swatch = colorByParticipant.get(p.id)!;
		out.push(
			`<span class="p-item">` +
				`<span class="swatch" style="background:${escapeHtml(swatch)}"></span>` +
				`<strong>${escapeHtml(p.id)}</strong>` +
				`<span class="role">${escapeHtml(p.role)}${
					p.adapter ? ` · ${escapeHtml(p.adapter)}` : ""
				}</span>` +
				(p.status === "dropped"
					? `<span class="dropped">dropped${
							p.droppedReason ? ` (${escapeHtml(p.droppedReason)})` : ""
						}</span>`
					: "") +
				`</span>`,
		);
	}
	out.push("</div>");
	out.push("</div>");

	// Jobs card
	if (jobs.length > 0) {
		out.push('<div class="card">');
		out.push("<h2>Jobs</h2>");
		out.push('<table class="jobs-table">');
		out.push(
			"<thead><tr><th>id</th><th>status</th><th>reason</th><th>rounds</th><th>lastSeq</th><th>finished</th></tr></thead>",
		);
		out.push("<tbody>");
		for (const job of jobs) {
			const reason = job.terminationReason ?? job.cancelReason ?? job.error?.code ?? "—";
			out.push(
				`<tr>` +
					`<td><code>${escapeHtml(job.id)}</code></td>` +
					`<td><span class="pill ${statusClass(job.status)}">${escapeHtml(job.status)}</span></td>` +
					`<td>${escapeHtml(reason)}</td>` +
					`<td>${job.rounds}</td>` +
					`<td>${job.lastSeq}</td>` +
					`<td><code>${escapeHtml(job.finishedAt ?? "—")}</code></td>` +
					`</tr>`,
			);
		}
		out.push("</tbody></table>");
		out.push("</div>");
	}

	// Body
	out.push('<div class="card">');
	out.push("<h2>Transcript</h2>");
	if (events !== null) {
		out.push('<pre style="white-space:pre-wrap;font-size:12px">');
		out.push(escapeHtml(JSON.stringify(events, null, 2)));
		out.push("</pre>");
	} else {
		const groups = groupByRound(messages);
		const totalRounds = groups.length;
		groups.forEach((group, idx) => {
			const isRecent = idx >= totalRounds - 3;
			const label = group.round === 0 ? "Opening" : `Round ${group.round}`;
			out.push(
				`<details class="round"${isRecent ? " open" : ""}>` +
					`<summary>${escapeHtml(label)}</summary>`,
			);
			for (const m of group.messages) {
				if (m.kind === "pass") {
					out.push(
						`<div class="pass"><span class="chip">${escapeHtml(String(m.author))} passed</span></div>`,
					);
					continue;
				}
				if (m.kind === "system") {
					out.push(`<div class="system">⚠ ${escapeHtml(truncate(m.text, 1000))}</div>`);
					continue;
				}
				const bg = colorByParticipant.get(String(m.author)) ?? "hsl(0,0%,93%)";
				// `speech`/`pass` messages: facilitator id is not in the member index.
				const memberIdx = memberIndexByParticipant.get(String(m.author));
				const layoutClass = memberIdx === undefined ? "facilitator" : bubbleSide(memberIdx);
				const body = renderMarkdownToHtml(m.text);
				out.push(
					`<div class="msg ${layoutClass}">` +
						`<div class="col">` +
						`<div class="author">${escapeHtml(String(m.author))}` +
						`<span class="time">${escapeHtml(m.createdAt)}</span></div>` +
						`<div class="bubble" style="background:${escapeHtml(bg)}">${body}</div>` +
						`</div>` +
						`</div>`,
				);
			}
			out.push("</details>");
		});
	}
	out.push("</div>");

	out.push(
		`<div class="footer">Generated by veche ${escapeHtml(version)} · ${escapeHtml(generatedAt)}</div>`,
	);
	out.push("</div></body></html>");
	return `${out.join("\n")}\n`;
};
