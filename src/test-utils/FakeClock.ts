import type { ClockPort } from "../shared/ports/ClockPort.js";
import { type Instant, instantFromDate } from "../shared/types/instant.js";

export class FakeClock implements ClockPort {
	private currentMs: number;

	constructor(initialIso = "2026-01-01T00:00:00.000Z") {
		this.currentMs = Date.parse(initialIso);
	}

	now(): Instant {
		return instantFromDate(new Date(this.currentMs));
	}

	monoNow(): number {
		return this.currentMs;
	}

	advance(ms: number): void {
		this.currentMs += ms;
	}
}
