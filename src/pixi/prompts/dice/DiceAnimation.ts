export const ROLL_IMPACT_MS = 70;
export const ROLL_SETTLE_MS = 180;

const ROLL_MIN_DISTANCE = 26;
const ROLL_MAX_DISTANCE = 58;
const ROLL_MIN_FLIGHT_MS = 420;
const ROLL_MAX_FLIGHT_MS = 600;
const ROLL_VALUE_FRAME_MS = 70;

export interface RollTrajectory {
  startX: number;
  startY: number;
  controlX: number;
  controlY: number;
  spinDirection: number;
  turns: number;
  flightMs: number;
}

export function rollSeed(
  promptId: number | string | undefined,
  round: number,
  index: number,
): number {
  const promptSeed =
    typeof promptId === "string"
      ? [...promptId].reduce(
          (value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619),
          2166136261,
        )
      : (promptId ?? 0);
  let value = promptSeed ^ Math.imul(round + 1, 0x45d9f3b) ^ Math.imul(index + 1, 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return value >>> 0;
}

export function rollRandom(seed: number, salt: number): number {
  let value = seed ^ Math.imul(salt + 1, 0x9e3779b1);
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  return (value >>> 0) / 0x1_0000_0000;
}

export function rollingDieValue(sides: number, elapsedMs: number, seed: number): number {
  const frame = Math.max(0, Math.floor(elapsedMs / ROLL_VALUE_FRAME_MS));
  return 1 + Math.floor(rollRandom(seed, frame) * Math.max(1, sides));
}

export function rollTrajectory(seed: number): RollTrajectory {
  const angle = rollRandom(seed, 1) * Math.PI * 2;
  const distanceProgress = rollRandom(seed, 2);
  const distance = ROLL_MIN_DISTANCE + (ROLL_MAX_DISTANCE - ROLL_MIN_DISTANCE) * distanceProgress;
  const bendDirection = rollRandom(seed, 3) > 0.5 ? 1 : -1;
  const bend = bendDirection * (6 + rollRandom(seed, 4) * 10);
  return {
    startX: Math.cos(angle) * distance,
    startY: Math.sin(angle) * distance * 0.65,
    controlX: -Math.sin(angle) * bend,
    controlY: Math.cos(angle) * bend - 6,
    spinDirection: rollRandom(seed, 5) > 0.5 ? 1 : -1,
    turns: 1 + Math.floor(distanceProgress * 2 + rollRandom(seed, 6)),
    flightMs: Math.round(
      ROLL_MIN_FLIGHT_MS + (ROLL_MAX_FLIGHT_MS - ROLL_MIN_FLIGHT_MS) * distanceProgress,
    ),
  };
}
