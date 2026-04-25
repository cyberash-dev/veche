import type { ServerResponse } from "node:http";

const SSE_HEADERS = {
	"Content-Type": "text/event-stream; charset=utf-8",
	"Cache-Control": "no-cache, no-transform",
	Connection: "keep-alive",
	"X-Accel-Buffering": "no",
	"X-Content-Type-Options": "nosniff",
} as const;

const escapeForData = (raw: string): string => raw.replace(/\r?\n/g, "\\n");

export class SseChannel {
	private isOpen = true;

	constructor(private readonly response: ServerResponse) {}

	writeHeaders(): void {
		this.response.writeHead(200, SSE_HEADERS);
		this.response.write(":ok\n\n");
	}

	writeEvent(event: string, payload: unknown, eventId: string | null = null): void {
		if (!this.isOpen) {
			return;
		}
		const lines: string[] = [];
		lines.push(`event: ${event}`);
		if (eventId !== null) {
			lines.push(`id: ${eventId}`);
		}
		const data = escapeForData(JSON.stringify(payload));
		lines.push(`data: ${data}`);
		lines.push("");
		lines.push("");
		this.response.write(lines.join("\n"));
	}

	writeKeepalive(): void {
		if (!this.isOpen) {
			return;
		}
		this.response.write(":keepalive\n\n");
	}

	close(): void {
		if (!this.isOpen) {
			return;
		}
		this.isOpen = false;
		this.response.end();
	}

	get isClosed(): boolean {
		return !this.isOpen;
	}
}
