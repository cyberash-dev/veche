import { DomainError } from "../../../shared/errors/DomainError.js";

export interface SerializedTurnError {
	readonly code: string;
	readonly message: string;
	readonly retryable: boolean;
}

abstract class AdapterError extends DomainError {
	abstract readonly retryable: boolean;
	asTurnError(): SerializedTurnError {
		return { code: this.code, message: this.message, retryable: this.retryable };
	}
}

export class AdapterNotAvailable extends AdapterError {
	readonly retryable = false as const;
	constructor(code: string, message: string, details: Record<string, unknown> = {}) {
		super(code, message, { ...details, errorClass: "AdapterNotAvailable" });
	}
}

export class AdapterConfigInvalid extends AdapterError {
	readonly retryable = false as const;
	constructor(code: string, message: string, details: Record<string, unknown> = {}) {
		super(code, message, { ...details, errorClass: "AdapterConfigInvalid" });
	}
}

export class AdapterTurnTimeout extends AdapterError {
	readonly retryable = true as const;
	constructor(code: string, message: string, details: Record<string, unknown> = {}) {
		super(code, message, { ...details, errorClass: "AdapterTurnTimeout" });
	}
}

export class AdapterInvocationError extends AdapterError {
	readonly retryable: boolean;

	constructor(
		code: string,
		message: string,
		retryable: boolean,
		details: Record<string, unknown> = {},
	) {
		super(code, message, { ...details, errorClass: "AdapterInvocationError", retryable });
		this.retryable = retryable;
	}
}

export class AdapterParseError extends AdapterError {
	readonly retryable = false as const;
	constructor(code: string, message: string, details: Record<string, unknown> = {}) {
		super(code, message, { ...details, errorClass: "AdapterParseError" });
	}
}

export class ProfileNotFound extends DomainError {
	constructor(name: string) {
		super("ProfileNotFound", `Profile ${name} not found in user config`, { name });
	}
}

export class ProfileAdapterMismatch extends DomainError {
	constructor(name: string, expected: string, actual: string) {
		super(
			"ProfileAdapterMismatch",
			`Profile ${name} uses adapter ${actual}; caller specified ${expected}`,
			{ name, expected, actual },
		);
	}
}

export class AdapterFlagNotAllowed extends DomainError {
	constructor(adapter: string, flag: string) {
		super("AdapterFlagNotAllowed", `Flag ${flag} is not allow-listed for ${adapter}`, {
			adapter,
			flag,
		});
	}
}
