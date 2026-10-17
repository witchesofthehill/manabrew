import type {
  LimitedHandPosition,
  LimitedHandRandom,
  LimitedHandSample,
} from "@/lib/limitedHand.types";
import type { DraftCard } from "@/types/limited";

export const LIMITED_OPENING_HAND_SIZE = 7;

export function shuffleLimitedHandIndices(
  indices: readonly number[],
  random: LimitedHandRandom = Math.random,
): number[] {
  const shuffled = [...indices];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

export function dealLimitedHand(
  cards: readonly DraftCard[],
  position: LimitedHandPosition = "play",
  random: LimitedHandRandom = Math.random,
): LimitedHandSample {
  const copies = cards.map((card) => ({ ...card }));
  const shuffled = shuffleLimitedHandIndices(
    copies.map((_, index) => index),
    random,
  );
  const count = Math.min(LIMITED_OPENING_HAND_SIZE, copies.length);
  return {
    cards: copies,
    hand: shuffled.slice(0, count),
    library: shuffled.slice(count),
    bottom: [],
    mulligans: 0,
    kept: false,
    turn: 0,
    position,
    lastDrawn: null,
  };
}

export function limitedHandBottomRequired(sample: LimitedHandSample): number {
  return sample.kept ? 0 : Math.min(sample.mulligans, sample.hand.length);
}

export function canMulliganLimitedHand(sample: LimitedHandSample): boolean {
  return (
    !sample.kept && sample.mulligans < Math.min(LIMITED_OPENING_HAND_SIZE, sample.cards.length)
  );
}

export function mulliganLimitedHand(
  sample: LimitedHandSample,
  random: LimitedHandRandom = Math.random,
): LimitedHandSample {
  if (!canMulliganLimitedHand(sample)) return sample;
  const shuffled = shuffleLimitedHandIndices(
    [...sample.hand, ...sample.library, ...sample.bottom],
    random,
  );
  const count = Math.min(LIMITED_OPENING_HAND_SIZE, sample.cards.length);
  return {
    ...sample,
    hand: shuffled.slice(0, count),
    library: shuffled.slice(count),
    bottom: [],
    mulligans: sample.mulligans + 1,
    lastDrawn: null,
  };
}

export function keepLimitedHand(
  sample: LimitedHandSample,
  selected: readonly number[],
): LimitedHandSample {
  const chosen = new Set(selected);
  if (
    sample.kept ||
    selected.length !== limitedHandBottomRequired(sample) ||
    chosen.size !== selected.length ||
    selected.some((index) => !sample.hand.includes(index))
  )
    return sample;
  return {
    ...sample,
    hand: sample.hand.filter((index) => !chosen.has(index)),
    bottom: [...selected],
    kept: true,
  };
}

export function limitedHandLibraryCount(sample: LimitedHandSample): number {
  return sample.library.length + sample.bottom.length;
}

export function canAdvanceLimitedHandTurn(sample: LimitedHandSample): boolean {
  return (
    sample.kept &&
    ((sample.turn === 0 && sample.position === "play") || limitedHandLibraryCount(sample) > 0)
  );
}

export function advanceLimitedHandTurn(sample: LimitedHandSample): LimitedHandSample {
  if (!canAdvanceLimitedHandTurn(sample)) return sample;
  const turn = sample.turn + 1;
  if (turn === 1 && sample.position === "play") {
    return { ...sample, turn, lastDrawn: null };
  }
  const fromLibrary = sample.library.length > 0;
  const drawn = fromLibrary ? sample.library[0] : sample.bottom[0];
  return {
    ...sample,
    turn,
    hand: [...sample.hand, drawn],
    library: fromLibrary ? sample.library.slice(1) : sample.library,
    bottom: fromLibrary ? sample.bottom : sample.bottom.slice(1),
    lastDrawn: drawn,
  };
}
