import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Module-level so React's idempotency check never sees an impure call in a
// component's render scope, even when it only runs from an event handler.
export function pickRandom<T>(arr: readonly T[]): T | undefined {
  return pickRandomDistinct(arr, 1)[0];
}

export function pickRandomDistinct<T>(arr: readonly T[], count: number): T[] {
  const remaining = [...arr];
  const picks: T[] = [];
  while (picks.length < count && remaining.length > 0) {
    const index = Math.floor(Math.random() * remaining.length);
    picks.push(remaining.splice(index, 1)[0]!);
  }
  return picks;
}
