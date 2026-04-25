import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { MeetingStorePort } from "../../../features/persistence/ports/MeetingStorePort.js";
import type { ClockPort } from "../../../shared/ports/ClockPort.js";
import type { LoggerPort } from "../../../shared/ports/LoggerPort.js";
import {
	handleGetMeeting,
	handleGetMessages,
	handleListMeetings,
	writeNotFound,
	writeServerError,
	writeWrongHost,
} from "./MeetingsApi.js";
import type { SseChannel } from "./SseChannel.js";
import { streamMeeting, streamMeetings } from "./StreamApi.js";
import { renderSpa } from "./spa/index.html.js";

export interface WatchServerOptions {
	readonly host: string;
	readonly port: number;
	readonly version: string;
}

export interface WatchServerDeps {
	readonly store: MeetingStorePort;
	readonly clock: ClockPort;
	readonly logger: LoggerPort;
}

export interface WatchServerStartResult {
	readonly host: string;
	readonly port: number;
	readonly url: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const isLoopbackHost = (host: string): boolean => {
	if (LOOPBACK_HOSTS.has(host)) {
		return true;
	}
	if (host.startsWith("127.")) {
		return true;
	}
	return false;
};

const allowedHostHeaders = (boundHost: string, port: number): Set<string> => {
	const portSuffix = `:${port}`;
	const candidates = ["localhost", "127.0.0.1", "[::1]"];
	const set = new Set<string>();
	for (const candidate of candidates) {
		set.add(candidate);
		set.add(`${candidate}${portSuffix}`);
	}
	if (boundHost && !set.has(boundHost)) {
		set.add(boundHost);
		set.add(`${boundHost}${portSuffix}`);
	}
	return set;
};

const isHostAllowed = (headerValue: string | undefined, allowed: ReadonlySet<string>): boolean => {
	if (typeof headerValue !== "string") {
		return false;
	}
	const normalized = headerValue.toLowerCase().trim();
	return allowed.has(normalized);
};

interface RouteMatch {
	readonly kind:
		| "spa"
		| "list-meetings"
		| "get-meeting"
		| "get-messages"
		| "stream-meetings"
		| "stream-meeting"
		| "not-found";
	readonly meetingId?: string;
}

const matchRoute = (method: string, pathname: string): RouteMatch => {
	if (method !== "GET") {
		return { kind: "not-found" };
	}
	if (pathname === "/" || pathname === "/index.html") {
		return { kind: "spa" };
	}
	if (pathname === "/api/meetings") {
		return { kind: "list-meetings" };
	}
	if (pathname === "/api/stream") {
		return { kind: "stream-meetings" };
	}
	const messagesMatch = /^\/api\/meetings\/([^/]+)\/messages$/.exec(pathname);
	if (messagesMatch) {
		return { kind: "get-messages", meetingId: decodeURIComponent(messagesMatch[1]!) };
	}
	const meetingMatch = /^\/api\/meetings\/([^/]+)$/.exec(pathname);
	if (meetingMatch) {
		return { kind: "get-meeting", meetingId: decodeURIComponent(meetingMatch[1]!) };
	}
	const streamMatch = /^\/api\/stream\/([^/]+)$/.exec(pathname);
	if (streamMatch) {
		return { kind: "stream-meeting", meetingId: decodeURIComponent(streamMatch[1]!) };
	}
	return { kind: "not-found" };
};

export class WatchServer {
	private server: Server | null = null;
	private readonly channels = new Set<SseChannel>();
	private spaCache: string | null = null;
	private boundHost = "";
	private boundPort = 0;
	private allowedHosts: Set<string> | null = null;

	constructor(
		private readonly options: WatchServerOptions,
		private readonly deps: WatchServerDeps,
	) {}

	async start(): Promise<WatchServerStartResult> {
		if (this.server !== null) {
			throw new Error("WatchServer already started");
		}
		const server = createServer((request, response) => {
			this.handle(request, response).catch((err) => {
				this.deps.logger.error("watch.handler-crashed", {
					message: (err as Error).message,
					stack: (err as Error).stack,
				});
				if (!response.headersSent) {
					try {
						writeServerError(response, "internal");
					} catch {
						// ignore: response may already be partially flushed.
					}
				} else {
					try {
						response.end();
					} catch {
						// ignore: response may already be ended.
					}
				}
			});
		});
		this.server = server;

		await new Promise<void>((resolve, reject) => {
			const onError = (err: Error): void => {
				server.removeListener("listening", onListening);
				reject(err);
			};
			const onListening = (): void => {
				server.removeListener("error", onError);
				resolve();
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen({ host: this.options.host, port: this.options.port });
		});

		const address = server.address() as AddressInfo;
		this.boundHost = this.options.host;
		this.boundPort = address.port;
		this.allowedHosts = allowedHostHeaders(this.boundHost, this.boundPort);
		const displayHost = this.boundHost.includes(":") ? `[${this.boundHost}]` : this.boundHost;
		const url = `http://${displayHost}:${this.boundPort}/`;
		this.deps.logger.info("watch.listening", { host: this.boundHost, port: this.boundPort });
		return { host: this.boundHost, port: this.boundPort, url };
	}

	async stop(): Promise<void> {
		const server = this.server;
		if (server === null) {
			return;
		}
		this.server = null;
		for (const channel of Array.from(this.channels)) {
			channel.close();
			this.channels.delete(channel);
		}
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections?.();
		});
	}

	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const method = request.method ?? "GET";
		const rawUrl = request.url ?? "/";
		const baseHost = `${this.boundHost.includes(":") ? `[${this.boundHost}]` : this.boundHost}:${this.boundPort}`;
		const url = new URL(rawUrl, `http://${baseHost}`);

		if (
			isLoopbackHost(this.boundHost) &&
			this.allowedHosts !== null &&
			!isHostAllowed(request.headers.host, this.allowedHosts)
		) {
			writeWrongHost(response);
			return;
		}

		const route = matchRoute(method, url.pathname);
		switch (route.kind) {
			case "spa":
				this.serveSpa(response);
				return;
			case "list-meetings":
				await handleListMeetings(this.deps.store, url, response);
				return;
			case "get-meeting":
				await handleGetMeeting(this.deps.store, route.meetingId!, response);
				return;
			case "get-messages":
				await handleGetMessages(this.deps.store, route.meetingId!, url, response);
				return;
			case "stream-meetings":
				await streamMeetings(request, response, {
					store: this.deps.store,
					logger: this.deps.logger,
					channels: this.channels,
				});
				return;
			case "stream-meeting":
				await streamMeeting(
					request,
					response,
					{
						store: this.deps.store,
						logger: this.deps.logger,
						channels: this.channels,
					},
					route.meetingId!,
				);
				return;
			case "not-found":
				writeNotFound(response);
				return;
		}
	}

	private serveSpa(response: ServerResponse): void {
		if (this.spaCache === null) {
			this.spaCache = renderSpa(this.options.version);
		}
		const html = this.spaCache;
		response.writeHead(200, {
			"Content-Type": "text/html; charset=utf-8",
			"Content-Length": Buffer.byteLength(html, "utf8"),
			"Cache-Control": "no-cache",
			"X-Content-Type-Options": "nosniff",
		});
		response.end(html);
	}
}
