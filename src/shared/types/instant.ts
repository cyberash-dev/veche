import type { Branded } from "./ids.js";

export type Instant = Branded<string, "Instant">;

export const asInstant = (v: string): Instant => v as Instant;

export const instantFromDate = (d: Date): Instant => d.toISOString() as Instant;
