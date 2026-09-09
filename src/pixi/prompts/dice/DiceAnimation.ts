export const ROLL_FLIGHT_MS = 720;
export const ROLL_IMPACT_MS = 140;
export const ROLL_SETTLE_MS = 420;
export const ROLL_FINISH_MS = 1400;

interface RollTrajectory {
  startX: number;
  startY: number;
  controlX: number;
  controlY: number;
  direction: number;
  turns: number;
}

interface RollBurst {
  angle: number;
  distance: number;
  length: number;
  delay: number;
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

export function rollDelayMs(index: number, round: number): number {
  return index * 55 + round * 180;
}

export function rollDuration(count: number, maxRound: number): number {
  return ROLL_FINISH_MS + Math.max(0, count - 1) * 55 + maxRound * 180;
}

export function rollingDieValue(sides: number, elapsedMs: number, seed: number): number {
  const frame = Math.max(0, Math.floor(elapsedMs / 62));
  return 1 + Math.floor(rollRandom(seed, frame) * Math.max(1, sides));
}

export function rollTrajectory(seed: number): RollTrajectory {
  const direction = rollRandom(seed, 1) > 0.5 ? 1 : -1;
  return {
    startX: direction * (8 + rollRandom(seed, 2) * 18),
    startY: (rollRandom(seed, 3) - 0.5) * 14,
    controlX: direction * (18 + rollRandom(seed, 4) * 34),
    controlY: 18 + rollRandom(seed, 5) * 14,
    direction,
    turns: 2.3 + rollRandom(seed, 6) * 1.5,
  };
}

export function rollBurst(seed: number, index: number): RollBurst {
  return {
    angle: (index / 10) * Math.PI * 2 + rollRandom(seed, index + 20) * 0.55,
    distance: 58 + rollRandom(seed, index + 40) * 50,
    length: 0.42 + rollRandom(seed, index + 60) * 0.28,
    delay: rollRandom(seed, index + 80) * 0.08,
  };
}
