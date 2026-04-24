export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface LoggerPort {
	trace(event: string, fields?: LogFields): void;
	debug(event: string, fields?: LogFields): void;
	info(event: string, fields?: LogFields): void;
	warn(event: string, fields?: LogFields): void;
	error(event: string, fields?: LogFields): void;
	child(fields: LogFields): LoggerPort;
}
