export class DomainError extends Error {
	public readonly code: string;
	public readonly details: Record<string, unknown>;

	constructor(code: string, message: string, details: Record<string, unknown> = {}) {
		super(message);
		this.name = this.constructor.name;
		this.code = code;
		this.details = details;
	}
}

export class ValidationError extends DomainError {
	constructor(message: string, details: Record<string, unknown> = {}) {
		super("InvalidInput", message, details);
	}
}
