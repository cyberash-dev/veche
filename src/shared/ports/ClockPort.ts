import type { Instant } from "../types/instant.js";

export interface ClockPort {
	now(): Instant;
	/** milliseconds since unix epoch — used for measuring durations and scheduling. */
	monoNow(): number;
}
