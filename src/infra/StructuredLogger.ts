import type { LogFields, LoggerPort, LogLevel } from "../shared/ports/LoggerPort.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
};

export class StructuredLogger implements LoggerPort {
	constructor(
		private readonly level: LogLevel,
		private readonly base: LogFields = {},
	) {}

	trace(event: string, fields?: LogFields): void {
		this.emit("trace", event, fields);
	}
	debug(event: string, fields?: LogFields): void {
		this.emit("debug", event, fields);
	}
	info(event: string, fields?: LogFields): void {
		this.emit("info", event, fields);
	}
	warn(event: string, fields?: LogFields): void {
		this.emit("warn", event, fields);
	}
	error(event: string, fields?: LogFields): void {
		this.emit("error", event, fields);
	}

	child(fields: LogFields): LoggerPort {
		return new StructuredLogger(this.level, { ...this.base, ...fields });
	}

	private emit(level: LogLevel, event: string, fields?: LogFields): void {
		if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
			return;
		}
		const record = {
			ts: new Date().toISOString(),
			level,
			event,
			...this.base,
			...(fields ?? {}),
		};
		process.stderr.write(`${JSON.stringify(record)}\n`);
	}
}
