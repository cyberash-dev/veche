import { DomainError } from "../../../shared/errors/DomainError.js";

interface McpToolError {
	readonly code: string;
	readonly message: string;
	readonly isError: true;
	readonly details?: Record<string, unknown>;
}

export const toMcpError = (err: unknown): McpToolError => {
	if (err instanceof DomainError) {
		return {
			code: err.code,
			message: err.message,
			isError: true,
			details: err.details,
		};
	}
	const message = err instanceof Error ? err.message : String(err);
	return { code: "internal_error", message, isError: true };
};
