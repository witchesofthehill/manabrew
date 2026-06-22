import type { Deck } from "@/protocol/deck";
import type { SpellbookCombo } from "@/api/commanderSpellbook";
import { normalizeCardName } from "@/lib/gameChangers";

export type Bracket = 1 | 2 | 3 | 4 | 5;

export const BRACKET_INFO: Record<Bracket, { name: string; blurb: string }> = {
  1: { name: "Exhibition", blurb: "Ultra-casual, theme over power." },
  2: { name: "Core", blurb: "Unoptimized, precon-level." },
  3: { name: "Upgraded", blurb: "Tuned; 1–3 Game Changers." },
  4: { name: "Optimized", blurb: "High-power; no card restrictions." },
  5: { name: "cEDH", blurb: "Built for the competitive metagame." },
};

const MASS_LAND_DENIAL = new Set<string>([
  "armageddon",
  "ravages of war",
  "catastrophe",
  "jokulhaups",
  "obliterate",
  "decree of annihilation",
  "impending disaster",
  "sunder",
  "devastation",
  "death cloud",
  "worldfire",
  "fall of the thran",
  "wildfire",
  "burning of xinye",
  "boom // bust",
  "cleansing",
  "global ruin",
  "mana vortex",
  "epicenter",
]);

export interface BracketAssessment {
  /** Estimated bracket, constrained to 2–4. Bracket 1 (deliberately casual) and
   *  5 (self-declared cEDH) are not auto-assigned. */
  bracket: Bracket;
  gameChangers: string[];
  massLandDenial: string[];
  earlyCombos: number;
  reasons: string[];
}

function isEarlyTwoCardCombo(combo: SpellbookCombo): boolean {
  const distinct = new Set(combo.uses.map((u) => normalizeCardName(u.card.name)));
  if (distinct.size > 2) return false;
  return combo.produces.some((p) => /infinite|win the game|wins the game/i.test(p.feature.name));
}

export function assessBracket(
  deck: Deck,
  gameChangers: Set<string>,
  includedCombos: SpellbookCombo[],
): BracketAssessment {
  const deckCards = [...deck.cards, ...(deck.commanders ?? [])];

  const gcSeen = new Set<string>();
  const mldSeen = new Set<string>();
  const gameChangerNames: string[] = [];
  const massLandDenial: string[] = [];
  for (const card of deckCards) {
    const key = normalizeCardName(card.name);
    if (gameChangers.has(key) && !gcSeen.has(key)) {
      gcSeen.add(key);
      gameChangerNames.push(card.name);
    }
    if (MASS_LAND_DENIAL.has(key) && !mldSeen.has(key)) {
      mldSeen.add(key);
      massLandDenial.push(card.name);
    }
  }

  const earlyCombos = includedCombos.filter(isEarlyTwoCardCombo).length;
  const reasons: string[] = [];
  let bracket: Bracket;

  if (gameChangerNames.length >= 4) {
    bracket = 4;
    reasons.push(`${gameChangerNames.length} Game Changers (4 or more)`);
  } else if (massLandDenial.length > 0) {
    bracket = 4;
    reasons.push(`Mass land denial: ${massLandDenial.join(", ")}`);
  } else if (earlyCombos > 0) {
    bracket = 4;
    reasons.push(`${earlyCombos} two-card infinite combo${earlyCombos === 1 ? "" : "s"}`);
  } else if (gameChangerNames.length >= 1) {
    bracket = 3;
    reasons.push(
      `${gameChangerNames.length} Game Changer${gameChangerNames.length === 1 ? "" : "s"} (1–3)`,
    );
  } else {
    bracket = 2;
    reasons.push("No Game Changers, mass land denial, or early combos detected");
  }

  return { bracket, gameChangers: gameChangerNames, massLandDenial, earlyCombos, reasons };
}

/** Actionable steps to drop the deck to the next-lower bracket, or null when
 *  already at the auto-assignable floor (Bracket 2). */
export function bracketAdvice(
  assessment: BracketAssessment,
): { target: Bracket; actions: string[] } | null {
  const { bracket, gameChangers, massLandDenial, earlyCombos } = assessment;
  if (bracket >= 4) {
    const actions: string[] = [];
    if (gameChangers.length >= 4) {
      const cut = gameChangers.length - 3;
      actions.push(`Cut ${cut} Game Changer${cut === 1 ? "" : "s"}`);
    }
    if (massLandDenial.length > 0) {
      actions.push(`Remove mass land denial: ${massLandDenial.join(", ")}`);
    }
    if (earlyCombos > 0) {
      actions.push(`Remove ${earlyCombos} early two-card combo${earlyCombos === 1 ? "" : "s"}`);
    }
    return { target: 3, actions };
  }
  if (bracket === 3 && gameChangers.length > 0) {
    return {
      target: 2,
      actions: [
        `Cut all ${gameChangers.length} Game Changer${gameChangers.length === 1 ? "" : "s"}`,
      ],
    };
  }
  return null;
}
