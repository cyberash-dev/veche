import type { ClockPort } from "../shared/ports/ClockPort.js";
import { asInstant, type Instant } from "../shared/types/instant.js";

export class SystemClock implements ClockPort {
	now(): Instant {
		return asInstant(new Date().toISOString());
	}
	monoNow(): number {
		return Date.now();
	}
}
