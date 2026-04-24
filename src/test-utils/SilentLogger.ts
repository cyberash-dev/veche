import type { LogFields, LoggerPort } from "../shared/ports/LoggerPort.js";

export class SilentLogger implements LoggerPort {
	trace(_event: string, _fields?: LogFields): void {}
	debug(_event: string, _fields?: LogFields): void {}
	info(_event: string, _fields?: LogFields): void {}
	warn(_event: string, _fields?: LogFields): void {}
	error(_event: string, _fields?: LogFields): void {}
	child(_fields: LogFields): LoggerPort {
		return this;
	}
}
