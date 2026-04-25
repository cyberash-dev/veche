const SPA_STYLE = `
*,*::before,*::after { box-sizing: border-box; }
html,body { margin: 0; height: 100%; }
body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  color: #1f2328;
  background: #f6f8fa;
}
#app {
  display: grid;
  grid-template-rows: auto 1fr;
  grid-template-columns: 320px 1fr;
  grid-template-areas: "topbar topbar" "sidebar main";
  height: 100vh;
}
header.topbar {
  grid-area: topbar;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 44px;
  background: #24292f;
  color: #f6f8fa;
  border-bottom: 1px solid #d0d7de;
}
header.topbar .brand { font-weight: 600; letter-spacing: 0.02em; }
header.topbar .stats { font-size: 12px; opacity: 0.85; }
aside.sidebar {
  grid-area: sidebar;
  border-right: 1px solid #d0d7de;
  background: #ffffff;
  overflow-y: auto;
}
aside.sidebar h2 {
  margin: 0;
  padding: 12px 16px 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #57606a;
}
ul.meeting-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
li.meeting-card {
  padding: 10px 16px;
  border-left: 3px solid transparent;
  border-bottom: 1px solid #eaeef2;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
li.meeting-card:hover { background: #f6f8fa; }
li.meeting-card.selected {
  border-left-color: #0969da;
  background: #ddf4ff;
}
li.meeting-card.fade-in {
  animation: fadeIn 350ms ease;
}
@keyframes fadeIn {
  from { background: #fff8c5; }
  to { background: transparent; }
}
li.meeting-card .title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}
li.meeting-card .meta {
  font-size: 12px;
  color: #57606a;
  margin-top: 2px;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6e7781;
}
.dot.active { background: #1a7f37; }
.dot.ended { background: #6e7781; }
.badge {
  display: inline-block;
  background: #0969da;
  color: #fff;
  border-radius: 10px;
  font-size: 11px;
  padding: 1px 7px;
  margin-left: auto;
  animation: pulse 700ms ease;
}
@keyframes pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.18); }
  100% { transform: scale(1); }
}
section.main {
  grid-area: main;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
section.main .header {
  padding: 14px 18px;
  border-bottom: 1px solid #d0d7de;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
section.main .header .title {
  font-size: 18px;
  font-weight: 600;
}
section.main .header .meta {
  font-size: 12px;
  color: #57606a;
}
section.main .toolbar {
  margin-left: auto;
  font-size: 12px;
}
section.main .transcript {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
}
.empty-state {
  color: #57606a;
  padding: 40px;
  text-align: center;
}
.round-divider {
  text-align: center;
  margin: 24px 0 12px;
  font-size: 12px;
  color: #57606a;
  letter-spacing: 0.06em;
}
.round-divider::before,
.round-divider::after {
  content: "";
  display: inline-block;
  width: 40px;
  height: 1px;
  background: #d0d7de;
  vertical-align: middle;
  margin: 0 10px;
}
.bubble {
  max-width: 70%;
  margin: 8px 0;
  padding: 10px 14px;
  border-radius: 14px;
  word-wrap: break-word;
  background: #fff;
  border: 1px solid #d0d7de;
}
.bubble .author {
  font-size: 11px;
  font-weight: 600;
  color: #57606a;
  margin-bottom: 4px;
  letter-spacing: 0.02em;
}
.bubble .body {
  white-space: normal;
}
.bubble .body > :first-child { margin-top: 0; }
.bubble .body > :last-child { margin-bottom: 0; }
.bubble .body p { margin: 6px 0; }
.bubble .body h1,
.bubble .body h2,
.bubble .body h3 {
  margin: 10px 0 6px;
  line-height: 1.25;
}
.bubble .body h1 { font-size: 1.25em; }
.bubble .body h2 { font-size: 1.1em; }
.bubble .body h3 { font-size: 1em; }
.bubble .body ul,
.bubble .body ol {
  margin: 6px 0;
  padding-left: 22px;
}
.bubble .body li { margin: 2px 0; }
.bubble .body blockquote {
  margin: 6px 0;
  padding: 4px 10px;
  border-left: 3px solid #afb8c1;
  color: #57606a;
}
.bubble .body code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 0.92em;
  background: rgba(27, 31, 35, 0.08);
  padding: 1px 4px;
  border-radius: 4px;
}
.bubble .body pre {
  margin: 6px 0;
  padding: 8px 10px;
  background: rgba(27, 31, 35, 0.06);
  border-radius: 6px;
  overflow-x: auto;
}
.bubble .body pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
}
.bubble .body hr {
  border: none;
  border-top: 1px solid #d0d7de;
  margin: 8px 0;
}
.bubble .body table {
  border-collapse: collapse;
  margin: 6px 0;
  font-size: 0.92em;
}
.bubble .body th,
.bubble .body td {
  border: 1px solid #d0d7de;
  padding: 3px 8px;
}
.bubble .body th { background: rgba(27, 31, 35, 0.04); }
.bubble .body a { color: #0969da; text-decoration: underline; }
.bubble.left { margin-right: auto; }
.bubble.right { margin-left: auto; }
.bubble.facilitator {
  margin: 16px auto;
  max-width: 80%;
  background: #ededed;
  font-style: italic;
  text-align: center;
  border-radius: 10px;
}
.bubble.facilitator .body { text-align: left; }
.bubble.system {
  margin: 12px auto;
  max-width: 70%;
  background: #fff8c5;
  border-color: #d4a72c;
  text-align: center;
  font-size: 12px;
  color: #57606a;
  white-space: pre-wrap;
}
.bubble.pass {
  margin: 6px 0;
  background: #eaeef2;
  border: none;
  font-size: 12px;
  color: #57606a;
  text-align: center;
  padding: 4px 10px;
  border-radius: 999px;
  display: inline-block;
}
.status-pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.status-pill.active { background: #dafbe1; color: #1a7f37; }
.status-pill.ended { background: #eaeef2; color: #57606a; }
`;

const escapeHtmlServer = (raw: string): string =>
	raw
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

// The inline script is the live SPA. It opens two EventSource streams and renders deltas
// strictly via textContent / dataset. No interpolation of SSE payload into innerHTML, ever.
const SPA_SCRIPT = `
"use strict";
(function () {
  const sidebarEl = document.getElementById("meeting-list");
  const transcriptEl = document.getElementById("transcript");
  const headerEl = document.getElementById("transcript-header");
  const statsEl = document.getElementById("stats");
  const autoscrollToggle = document.getElementById("autoscroll");
  const meetings = new Map();
  let listSource = null;
  let transcriptSource = null;
  let selectedId = null;
  let unread = new Map();
  let participantById = new Map();
  let participantOrder = [];

  function sha1Hue(text) {
    // synchronous fallback hue from string — not crypto, just stable mapping.
    let h = 0;
    for (let i = 0; i < text.length; i += 1) {
      h = (h * 31 + text.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % 360;
  }

  function participantColor(id, role) {
    if (role === "facilitator") return "hsl(0, 0%, 93%)";
    return "hsl(" + sha1Hue(id) + ", 60%, 86%)";
  }

  function truncate(s, max) {
    return s.length <= max ? s : s.slice(0, max - 1) + "…";
  }

  function formatStats() {
    let active = 0;
    for (const s of meetings.values()) if (s.status === "active") active += 1;
    statsEl.textContent = active + " active · " + meetings.size + " total";
  }

  function renderSidebar() {
    sidebarEl.innerHTML = "";
    const summaries = Array.from(meetings.values()).sort(function (a, b) {
      if (a.createdAt === b.createdAt) return a.meetingId < b.meetingId ? 1 : -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    for (const s of summaries) {
      sidebarEl.appendChild(renderCard(s, false));
    }
    formatStats();
  }

  function renderCard(summary, fadeIn) {
    const li = document.createElement("li");
    li.className = "meeting-card";
    if (fadeIn) li.classList.add("fade-in");
    if (summary.meetingId === selectedId) li.classList.add("selected");
    li.dataset.meetingId = summary.meetingId;

    const titleRow = document.createElement("div");
    titleRow.className = "title";
    const dot = document.createElement("span");
    dot.className = "dot " + summary.status;
    titleRow.appendChild(dot);
    const titleText = document.createElement("span");
    titleText.textContent = truncate(summary.title || "(untitled)", 32);
    titleRow.appendChild(titleText);
    const unreadCount = unread.get(summary.meetingId) || 0;
    if (unreadCount > 0 && summary.meetingId !== selectedId) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = String(unreadCount);
      titleRow.appendChild(badge);
    }
    li.appendChild(titleRow);

    const meta = document.createElement("div");
    meta.className = "meta";
    const idShort = summary.meetingId.length > 12
      ? summary.meetingId.slice(0, 8) + "…"
      : summary.meetingId;
    const memberCount = summary.participants.length;
    meta.textContent =
      idShort + " · " + memberCount + "m · " + summary.openJobCount + "j";
    li.appendChild(meta);

    li.addEventListener("click", function () {
      selectMeeting(summary.meetingId);
    });
    return li;
  }

  function upsertCard(summary, fadeIn) {
    const previous = sidebarEl.querySelector('[data-meeting-id="' + cssEscape(summary.meetingId) + '"]');
    const card = renderCard(summary, fadeIn);
    if (previous) {
      previous.replaceWith(card);
    } else {
      sidebarEl.insertBefore(card, sidebarEl.firstChild);
    }
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return s.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function selectMeeting(meetingId) {
    if (selectedId === meetingId) return;
    selectedId = meetingId;
    unread.delete(meetingId);
    if (transcriptSource) {
      transcriptSource.close();
      transcriptSource = null;
    }
    headerEl.innerHTML = "";
    transcriptEl.innerHTML = "";
    participantById = new Map();
    participantOrder = [];
    for (const li of sidebarEl.querySelectorAll(".meeting-card")) {
      li.classList.toggle("selected", li.dataset.meetingId === meetingId);
    }
    transcriptSource = new EventSource("/api/stream/" + encodeURIComponent(meetingId));
    transcriptSource.addEventListener("hello", function (ev) {
      const payload = JSON.parse(ev.data);
      renderTranscriptHeader(payload);
      participantOrder = payload.participants.map(function (p) { return p.id; });
      participantById = new Map();
      for (const p of payload.participants) participantById.set(p.id, p);
      transcriptEl.innerHTML = "";
      let lastRound = -1;
      for (const m of payload.messages) {
        if (m.round !== lastRound) {
          transcriptEl.appendChild(renderRound(m.round));
          lastRound = m.round;
        }
        transcriptEl.appendChild(renderMessage(m));
      }
      maybeScroll();
    });
    transcriptSource.addEventListener("message.posted", function (ev) {
      const payload = JSON.parse(ev.data);
      const m = payload.message;
      const lastRoundEl = transcriptEl.querySelector(".round-divider:last-of-type");
      const lastRound = lastRoundEl ? Number(lastRoundEl.dataset.round) : -1;
      if (m.round !== lastRound) {
        transcriptEl.appendChild(renderRound(m.round));
      }
      transcriptEl.appendChild(renderMessage(m));
      maybeScroll();
    });
    transcriptSource.addEventListener("meeting.updated", function (ev) {
      const payload = JSON.parse(ev.data);
      meetings.set(payload.summary.meetingId, payload.summary);
      upsertCard(payload.summary, false);
      if (payload.summary.meetingId === selectedId) {
        renderTranscriptHeaderFromSummary(payload.summary);
      }
    });
    transcriptSource.addEventListener("error", function () {
      // EventSource auto-reconnects; nothing to do here.
    });
  }

  function renderTranscriptHeader(snapshot) {
    headerEl.innerHTML = "";
    const titleRow = document.createElement("div");
    titleRow.className = "title";
    titleRow.textContent = snapshot.meeting.title || "(untitled)";
    headerEl.appendChild(titleRow);

    const meta = document.createElement("div");
    meta.className = "meta";
    const pill = document.createElement("span");
    pill.className = "status-pill " + snapshot.meeting.status;
    pill.textContent = snapshot.meeting.status;
    meta.appendChild(pill);
    meta.appendChild(document.createTextNode(" · " + snapshot.meeting.id + " · created " + snapshot.meeting.createdAt));
    if (snapshot.meeting.endedAt) {
      meta.appendChild(document.createTextNode(" · ended " + snapshot.meeting.endedAt));
    }
    headerEl.appendChild(meta);

    const participants = document.createElement("div");
    participants.className = "meta";
    participants.textContent =
      "Participants: " +
      snapshot.participants
        .map(function (p) { return p.id + (p.adapter ? " (" + p.adapter + ")" : ""); })
        .join(", ");
    headerEl.appendChild(participants);
  }

  function renderTranscriptHeaderFromSummary(summary) {
    const pill = headerEl.querySelector(".status-pill");
    if (pill) {
      pill.className = "status-pill " + summary.status;
      pill.textContent = summary.status;
    }
  }

  function renderRound(round) {
    const div = document.createElement("div");
    div.className = "round-divider";
    div.dataset.round = String(round);
    div.textContent = round === 0 ? "Opening" : "Round " + round;
    return div;
  }

  function renderMessage(message) {
    if (message.kind === "pass") {
      const wrap = document.createElement("div");
      wrap.style.textAlign = "center";
      const pill = document.createElement("span");
      pill.className = "bubble pass";
      pill.textContent = message.author + " passed";
      wrap.appendChild(pill);
      return wrap;
    }
    if (message.kind === "system") {
      const div = document.createElement("div");
      div.className = "bubble system";
      div.textContent = "⚠ " + message.text;
      return div;
    }
    const participant = participantById.get(message.author);
    const role = participant ? participant.role : "member";
    const div = document.createElement("div");
    div.className = "bubble";
    if (role === "facilitator") {
      div.classList.add("facilitator");
    } else {
      const idx = participantOrder.indexOf(message.author);
      div.classList.add(idx >= 0 && idx % 2 === 0 ? "left" : "right");
    }
    div.style.background = participantColor(message.author, role);
    const author = document.createElement("div");
    author.className = "author";
    author.textContent = message.author;
    div.appendChild(author);
    const body = document.createElement("div");
    body.className = "body";
    if (typeof message.htmlBody === "string") {
      // Safe: server pre-rendered via the shared escape-then-transform Markdown pipeline.
      body.innerHTML = message.htmlBody;
    } else {
      body.textContent = message.text;
    }
    div.appendChild(body);
    return div;
  }

  function maybeScroll() {
    if (autoscrollToggle.checked) {
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }
  }

  function bumpUnread(meetingId) {
    if (meetingId === selectedId) return;
    const next = (unread.get(meetingId) || 0) + 1;
    unread.set(meetingId, next);
    const summary = meetings.get(meetingId);
    if (summary) upsertCard(summary, false);
  }

  function startListStream() {
    listSource = new EventSource("/api/stream");
    listSource.addEventListener("hello", function (ev) {
      const payload = JSON.parse(ev.data);
      meetings.clear();
      for (const s of payload.summaries) meetings.set(s.meetingId, s);
      renderSidebar();
    });
    listSource.addEventListener("meeting.added", function (ev) {
      const payload = JSON.parse(ev.data);
      meetings.set(payload.summary.meetingId, payload.summary);
      upsertCard(payload.summary, true);
      formatStats();
    });
    listSource.addEventListener("meeting.updated", function (ev) {
      const payload = JSON.parse(ev.data);
      const previous = meetings.get(payload.summary.meetingId);
      meetings.set(payload.summary.meetingId, payload.summary);
      upsertCard(payload.summary, false);
      formatStats();
      if (previous && payload.summary.lastSeq > previous.lastSeq) {
        bumpUnread(payload.summary.meetingId);
      }
    });
    listSource.addEventListener("error", function () {
      // EventSource auto-reconnects.
    });
  }

  startListStream();
})();
`;

const buildHtml = (version: string): string => {
	const versionAttr = escapeHtmlServer(version);
	return [
		"<!DOCTYPE html>",
		'<html lang="en">',
		"<head>",
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width,initial-scale=1">',
		'<meta name="generator" content="veche watch">',
		`<meta name="veche-version" content="${versionAttr}">`,
		"<title>veche · live</title>",
		`<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6' fill='%231a7f37'/%3E%3C/svg%3E">`,
		`<style>${SPA_STYLE}</style>`,
		"</head>",
		"<body>",
		'<div id="app">',
		'<header class="topbar">',
		'<span class="brand">veche · live</span>',
		'<span id="stats" class="stats">connecting…</span>',
		"</header>",
		'<aside class="sidebar">',
		"<h2>Meetings</h2>",
		'<ul id="meeting-list" class="meeting-list"></ul>',
		"</aside>",
		'<section class="main">',
		'<div id="transcript-header" class="header"></div>',
		'<div class="header" style="border-bottom: none; padding: 6px 18px;">',
		'<label class="toolbar"><input type="checkbox" id="autoscroll" checked> auto-scroll</label>',
		"</div>",
		'<div id="transcript" class="transcript"><div class="empty-state">Pick a meeting from the sidebar.</div></div>',
		"</section>",
		"</div>",
		`<script>${SPA_SCRIPT}</script>`,
		"</body>",
		"</html>",
		"",
	].join("\n");
};

let cached: { version: string; html: string } | null = null;

export const renderSpa = (version: string): string => {
	if (cached !== null && cached.version === version) {
		return cached.html;
	}
	const html = buildHtml(version);
	cached = { version, html };
	return html;
};
