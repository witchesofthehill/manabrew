// Mirrors Forge's DeckFormat (structural rules) + GameFormat (card legality).
// For our limited card pool, we combine both into a single GameFormat interface.

import type { Deck, DeckCard, DeckFormat } from "@/protocol/deck";

export interface GameFormat {
  id: DeckFormat;
  name: string;
  /** Short label used in badges, e.g. "STD" / "CMD" */
  shortName: string;
  description: string;
  /** Tailwind color variant key for FormatBadge */
  badgeColor: string;
  deckRules: {
    minDeckSize: number;
    maxDeckSize: number | null; // null = unlimited
    maxCopies: number; // 4 for Constructed, 1 for Commander
    sideboardMax: number;
    startingLife: number;
    requiresCommander: boolean;
  };
  bannedCards: string[];
}

/** Name-only fallback for callers without card data; prefer canHaveAnyNumberOf. */
export const BASIC_LAND_NAMES = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest"]);

/**
 * Returns true when a card's oracle text explicitly declares that a deck may
 * contain any number of copies (e.g. Relentless Rats, Shadowborn Apostle,
 * Dragon's Approach, Rat Colony …).
 *
 * Matches phrases like:
 *   "A deck can have any number of cards named …"
 *   "You may have any number of cards named …"
 */
const COPY_LIMIT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

export function copyLimitFromText(oracleText: string | undefined): number | null {
  if (!oracleText) return null;
  if (/any number of cards named/i.test(oracleText)) return Infinity;
  const match = oracleText.match(/up to (\w+) cards? named/i);
  if (match) {
    const word = match[1].toLowerCase();
    const n = COPY_LIMIT_WORDS[word] ?? Number(word);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function isBasicLand(card: DeckCard): boolean {
  return (card.supertypes?.includes("Basic") ?? false) && (card.types?.includes("Land") ?? false);
}

/** Mirrors Forge's DeckFormat.canHaveAnyNumberOf. */
export function canHaveAnyNumberOf(card: DeckCard): boolean {
  return isBasicLand(card) || copyLimitFromText(card.text) === Infinity;
}

export const GAME_FORMATS: GameFormat[] = [
  {
    id: "standard",
    name: "Standard",
    shortName: "STD",
    description: "60+ cards, max 4 copies, 20 life, rotating sets",
    badgeColor: "blue",
    deckRules: {
      minDeckSize: 60,
      maxDeckSize: null,
      maxCopies: 4,
      sideboardMax: 15,
      startingLife: 20,
      requiresCommander: false,
    },
    bannedCards: [],
  },
  {
    id: "pioneer",
    name: "Pioneer",
    shortName: "PIO",
    description: "60+ cards, max 4 copies, 20 life, Return to Ravnica forward",
    badgeColor: "amber",
    deckRules: {
      minDeckSize: 60,
      maxDeckSize: null,
      maxCopies: 4,
      sideboardMax: 15,
      startingLife: 20,
      requiresCommander: false,
    },
    bannedCards: [],
  },
  {
    id: "modern",
    name: "Modern",
    shortName: "MOD",
    description: "60+ cards, max 4 copies, 20 life, 8th Edition forward",
    badgeColor: "emerald",
    deckRules: {
      minDeckSize: 60,
      maxDeckSize: null,
      maxCopies: 4,
      sideboardMax: 15,
      startingLife: 20,
      requiresCommander: false,
    },
    bannedCards: [],
  },
  {
    id: "legacy",
    name: "Legacy",
    shortName: "LEG",
    description: "60+ cards, max 4 copies, 20 life, all sets, banned list",
    badgeColor: "rose",
    deckRules: {
      minDeckSize: 60,
      maxDeckSize: null,
      maxCopies: 4,
      sideboardMax: 15,
      startingLife: 20,
      requiresCommander: false,
    },
    bannedCards: [],
  },
  {
    id: "vintage",
    name: "Vintage",
    shortName: "VIN",
    description: "60+ cards, max 4 copies, 20 life, all sets, restricted list",
    badgeColor: "slate",
    deckRules: {
      minDeckSize: 60,
      maxDeckSize: null,
      maxCopies: 4,
      sideboardMax: 15,
      startingLife: 20,
      requiresCommander: false,
    },
    bannedCards: [],
  },
  {
    id: "pauper",
    name: "Pauper",
    shortName: "PAU",
    description: "60+ cards, max 4 copies, 20 life, commons only",
    badgeColor: "zinc",
    deckRules: {
      minDeckSize: 60,
      maxDeckSize: null,
      maxCopies: 4,
      sideboardMax: 15,
      startingLife: 20,
      requiresCommander: false,
    },
    bannedCards: [],
  },
  {
    id: "commander",
    name: "Commander",
    shortName: "CMD",
    description: "100 cards, singleton, 40 life, requires commander",
    badgeColor: "purple",
    deckRules: {
      minDeckSize: 100,
      maxDeckSize: 100,
      maxCopies: 1,
      sideboardMax: 10,
      startingLife: 40,
      requiresCommander: true,
    },
    bannedCards: [],
  },
  {
    id: "brawl",
    name: "Brawl",
    shortName: "BRL",
    description: "60 cards, singleton, 25 life, Standard-legal commander",
    badgeColor: "teal",
    deckRules: {
      minDeckSize: 60,
      maxDeckSize: 60,
      maxCopies: 1,
      sideboardMax: 0,
      startingLife: 25,
      requiresCommander: true,
    },
    bannedCards: [],
  },
  {
    id: "oathbreaker",
    name: "Oathbreaker",
    shortName: "OAT",
    description: "60 cards, singleton, 20 life, planeswalker + signature spell",
    badgeColor: "orange",
    deckRules: {
      minDeckSize: 60,
      maxDeckSize: 60,
      maxCopies: 1,
      sideboardMax: 10,
      startingLife: 20,
      requiresCommander: true,
    },
    bannedCards: [],
  },
  {
    id: "draft",
    name: "Draft",
    shortName: "DFT",
    description: "40+ cards, no copy limit, 20 life",
    badgeColor: "sky",
    deckRules: {
      minDeckSize: 40,
      maxDeckSize: null,
      maxCopies: Infinity,
      sideboardMax: Infinity,
      startingLife: 20,
      requiresCommander: false,
    },
    bannedCards: [],
  },
  {
    id: "sealed",
    name: "Sealed",
    shortName: "SLD",
    description: "40+ cards, no copy limit, 20 life",
    badgeColor: "indigo",
    deckRules: {
      minDeckSize: 40,
      maxDeckSize: null,
      maxCopies: Infinity,
      sideboardMax: Infinity,
      startingLife: 20,
      requiresCommander: false,
    },
    bannedCards: [],
  },
];

export interface DeckValidation {
  legal: boolean;
  errors: string[];
}

export interface DeckValidationInput {
  deck: Deck;
  /** Optional override of the commander used for validation; when set and not
   *  already in `deck.commanders`, the named card is treated as a commander
   *  pulled out of the main deck for legality purposes. */
  commanderName?: string;
}

export function getFormat(id: string): GameFormat | undefined {
  return GAME_FORMATS.find((f) => f.id === id);
}

/**
 * Validate a deck (as an array of card names, one per copy) against a format.
 * Basic lands and cards whose text explicitly allows any number of copies are
 * exempt from the per-card copy limit.
 *
 * @param copyLimits - optional map of card name → copy limit granted by the
 *   card's own text (derived from oracle text by the caller; Infinity = unlimited).
 */
export function validateDeck(
  cardNames: string[],
  format: GameFormat,
  copyLimits?: ReadonlyMap<string, number>,
): DeckValidation {
  const errors: string[] = [];
  const { minDeckSize, maxDeckSize, maxCopies } = format.deckRules;

  if (cardNames.length < minDeckSize) {
    errors.push(`Deck must have at least ${minDeckSize} cards (has ${cardNames.length})`);
  }
  if (maxDeckSize !== null && cardNames.length > maxDeckSize) {
    errors.push(`Deck must have at most ${maxDeckSize} cards (has ${cardNames.length})`);
  }

  // Count copies and check against limit
  const counts = new Map<string, number>();
  for (const name of cardNames) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of counts) {
    if (BASIC_LAND_NAMES.has(name)) continue;
    const limit = copyLimits?.get(name) ?? maxCopies;
    if (count > limit) {
      errors.push(`Too many copies of "${name}": ${count} (max ${limit})`);
    }
  }

  // Check banned list
  const seenBanned = new Set<string>();
  for (const name of cardNames) {
    if (format.bannedCards.includes(name) && !seenBanned.has(name)) {
      errors.push(`"${name}" is banned in ${format.name}`);
      seenBanned.add(name);
    }
  }

  return { legal: errors.length === 0, errors };
}

function getCardIdentity(card?: DeckCard): string[] {
  if (!card) return [];
  if (card.colorIdentity && card.colorIdentity.length > 0) {
    return [...new Set(card.colorIdentity)];
  }
  return [...new Set((card.color ?? "").split("").filter(Boolean))];
}

function hasPartner(card?: DeckCard): boolean {
  if (!card) return false;
  if (card.keywords?.some((k) => /^partner$/i.test(k.trim()))) return true;
  return /(?:^|\n)partner(?!\s+with)(?!\s*—)/im.test(card.text);
}

/**
 * Returns the specific partner name this card must pair with ("Partner with Xxx"),
 * or null if it doesn't have the specific-partner ability.
 */
function getPartnerWithName(card?: DeckCard): string | null {
  if (!card) return null;
  const fromKeywords = card.keywords?.find((k) => /^partner with /i.test(k));
  if (fromKeywords) return fromKeywords.replace(/^partner with /i, "").trim();
  const match = card.text.match(/partner with ([^\n(]+)/i);
  return match ? match[1].trim() : null;
}

function partnerType(card?: DeckCard): string | null {
  const fromKeywords = card?.keywords?.find((k) => /^partner:/i.test(k));
  if (fromKeywords) return fromKeywords.slice(fromKeywords.indexOf(":") + 1).trim();
  const match = card?.text.match(/partner\s*—\s*([^\n(]+)/i);
  return match ? match[1].trim() : null;
}

function hasChooseBackground(card?: DeckCard): boolean {
  if (!card) return false;
  return card.text.toLowerCase().includes("choose a background");
}

function isBackgroundCard(card?: DeckCard): boolean {
  if (!card) return false;
  return card.subtypes?.some((s) => s.toLowerCase() === "background") ?? false;
}

function hasDoctorsCompanion(card?: DeckCard): boolean {
  if (!card) return false;
  if (card.keywords?.some((k) => /^doctor's companion$/i.test(k.trim()))) return true;
  return /doctor's companion/i.test(card.text);
}

function isTimeLordDoctor(card?: DeckCard): boolean {
  const subtypes = card?.subtypes?.join(" ").toLowerCase() ?? "";
  return subtypes.includes("time lord") && subtypes.includes("doctor");
}

export function partnerPairLabel(a: DeckCard, b: DeckCard): string | null {
  if (hasPartner(a) && hasPartner(b)) return "Partner";
  const typeA = partnerType(a);
  if (typeA && typeA.toLowerCase() === partnerType(b)?.toLowerCase()) return typeA;
  const pwA = getPartnerWithName(a);
  const pwB = getPartnerWithName(b);
  if (
    pwA &&
    pwB &&
    pwA.toLowerCase() === b.identity.name.toLowerCase() &&
    pwB.toLowerCase() === a.identity.name.toLowerCase()
  )
    return "Partner with";
  if (hasChooseBackground(a) && isBackgroundCard(b)) return "Background";
  if (hasChooseBackground(b) && isBackgroundCard(a)) return "Background";
  if (hasDoctorsCompanion(a) && isTimeLordDoctor(b)) return "Doctor's companion";
  if (hasDoctorsCompanion(b) && isTimeLordDoctor(a)) return "Doctor's companion";
  return null;
}

/**
 * Returns true if two cards are a legal pair of partner commanders.
 * Handles: generic Partner, "Partner with [Name]", the restricted "Partner—Xxx"
 * types, Background, and Doctor's companion.
 */
export function canBePartners(a: DeckCard, b: DeckCard): boolean {
  return partnerPairLabel(a, b) !== null;
}

export function canBePartnerCommander(card?: DeckCard): boolean {
  if (isBackgroundCard(card)) return true;
  if (!isCommanderEligible(card)) return false;
  return (
    hasPartner(card) ||
    getPartnerWithName(card) !== null ||
    partnerType(card) !== null ||
    hasChooseBackground(card) ||
    hasDoctorsCompanion(card) ||
    isTimeLordDoctor(card)
  );
}

export function isCommanderEligible(card?: DeckCard): boolean {
  if (!card) return false;
  const isLegendary = card.supertypes.includes("Legendary");
  if (isLegendary && card.types.includes("Creature")) return true;
  if (
    isLegendary &&
    card.subtypes?.some((s) => ["vehicle", "spacecraft"].includes(s.toLowerCase()))
  )
    return true;
  // Also allow legendary planeswalkers that say "can be your commander"
  // and backgrounds (for "choose a background")
  const hasCommanderText = card.text.toLowerCase().includes("can be your commander");
  if (hasCommanderText) return true;
  const isBackground = card.subtypes?.some((s) => s.toLowerCase() === "background") ?? false;
  if (isBackground) return true;
  return false;
}

export function commanderPairLabel(commanders: DeckCard[], formatId?: string): string | null {
  if (commanders.length !== 2) return null;
  if (formatId === "oathbreaker") {
    return commanders.some((c) => canBeOathbreaker(c)) &&
      commanders.some((c) => canBeSignatureSpell(c))
      ? "Signature spell"
      : null;
  }
  return partnerPairLabel(commanders[0], commanders[1]);
}

export function commanderSlotBadge(
  commanders: DeckCard[],
  formatId: string | undefined,
  index: number,
): { label: string | null } | null {
  const card = commanders[index];
  if (!card) return null;

  if (formatId !== "oathbreaker") {
    return index === 1 ? { label: partnerPairLabel(commanders[0], card) } : null;
  }

  const oathbreakers = commanders.filter((c) => canBeOathbreaker(c));
  if (canBeSignatureSpell(card)) {
    const paired = oathbreakers[commanders.filter((c) => canBeSignatureSpell(c)).indexOf(card)];
    return {
      label:
        oathbreakers.length > 1 && paired
          ? `Signature: ${paired.identity.name}`
          : "Signature spell",
    };
  }
  if (oathbreakers.length !== 2 || oathbreakers.indexOf(card) !== 1) return null;
  return { label: partnerPairLabel(oathbreakers[0], oathbreakers[1]) };
}

export function canBeOathbreaker(card?: DeckCard): boolean {
  if (!card) return false;
  if (card.text.toLowerCase().includes("can be your commander")) return true;
  return card.types.includes("Planeswalker");
}

export function canBeSignatureSpell(card?: DeckCard): boolean {
  if (!card) return false;
  return card.types.includes("Instant") || card.types.includes("Sorcery");
}

export function formatRequiresCommander(formatId?: string): boolean {
  return getFormat(formatId ?? "")?.deckRules.requiresCommander ?? false;
}

export function validateDeckSections(
  input: DeckValidationInput,
  format: GameFormat,
): DeckValidation {
  const { deck } = input;
  const errors: string[] = [];

  // Resolve commanders: deck.commanders takes precedence; otherwise the
  // override name (if present) pulls one card out of deck.cards for
  // legality checking.
  let commanders: DeckCard[] = deck.commanders ?? [];
  let mainDeck: DeckCard[] = deck.cards;
  if (commanders.length === 0 && input.commanderName) {
    const idx = mainDeck.findIndex((c) => c.identity.name === input.commanderName);
    if (idx >= 0) {
      commanders = [mainDeck[idx]];
      mainDeck = mainDeck.filter((_, i) => i !== idx);
    }
  }
  const sideboard = deck.sideboard;

  const availableCards: DeckCard[] = [
    ...deck.cards,
    ...sideboard,
    ...(deck.attractions ?? []),
    ...(deck.contraptions ?? []),
    ...(deck.schemes ?? []),
    ...(deck.planes ?? []),
    ...commanders,
  ];

  const copyLimits = new Map<string, number>();
  for (const c of availableCards) {
    if (canHaveAnyNumberOf(c)) {
      copyLimits.set(c.identity.name, Infinity);
      continue;
    }
    const limit = copyLimitFromText(c.text);
    if (limit !== null) copyLimits.set(c.identity.name, limit);
  }

  const baseValidation = validateDeck(
    [...mainDeck, ...commanders].map((c) => c.identity.name),
    format,
    copyLimits,
  );
  errors.push(...baseValidation.errors);

  if (sideboard.length > format.deckRules.sideboardMax) {
    errors.push(
      `Sideboard must have at most ${format.deckRules.sideboardMax} cards (has ${sideboard.length})`,
    );
  }

  if (format.deckRules.requiresCommander) {
    const expectedMainSize = format.deckRules.minDeckSize - commanders.length;
    if (mainDeck.length !== expectedMainSize) {
      errors.push(
        `${format.name} deck must have exactly ${expectedMainSize} non-commander cards (has ${mainDeck.length})`,
      );
    }

    let identitySource = commanders;
    if (format.id === "oathbreaker") {
      const oathbreakers = commanders.filter((c) => canBeOathbreaker(c));
      const spells = commanders.filter((c) => canBeSignatureSpell(c));

      for (const cmd of commanders) {
        if (!canBeOathbreaker(cmd) && !canBeSignatureSpell(cmd)) {
          errors.push(`"${cmd.identity.name}" is not a legal oathbreaker or signature spell`);
        }
      }

      if (oathbreakers.length === 0) errors.push("Deck is missing an oathbreaker");
      if (spells.length === 0) errors.push("Deck is missing a signature spell");
      if (oathbreakers.length > 2) {
        errors.push(`Deck can have at most 2 oathbreakers (has ${oathbreakers.length})`);
      } else if (oathbreakers.length === 2 && !canBePartners(oathbreakers[0], oathbreakers[1])) {
        errors.push(
          `"${oathbreakers[0].identity.name}" and "${oathbreakers[1].identity.name}" cannot be paired — two oathbreakers must have a compatible partner ability`,
        );
      }
      if (spells.length > Math.max(1, oathbreakers.length)) {
        errors.push(
          `Deck can have one signature spell per oathbreaker (has ${spells.length} for ${oathbreakers.length})`,
        );
      }

      identitySource = oathbreakers;
    } else {
      if (commanders.length === 0) {
        errors.push("Deck must have at least 1 commander");
      } else if (commanders.length > 2) {
        errors.push(`Deck can have at most 2 commanders (has ${commanders.length})`);
      }

      for (const cmd of commanders) {
        if (!isCommanderEligible(cmd)) {
          errors.push(`"${cmd.identity.name}" is not a legal commander`);
        }
      }

      if (commanders.length === 2 && !canBePartners(commanders[0], commanders[1])) {
        errors.push(
          `"${commanders[0].identity.name}" and "${commanders[1].identity.name}" cannot be paired — both commanders must have a compatible partner ability`,
        );
      }
    }

    const commanderIdentity = new Set(identitySource.flatMap((cmd) => getCardIdentity(cmd)));
    if (commanderIdentity.size > 0) {
      const invalid = [...mainDeck, ...commanders].find((card) =>
        getCardIdentity(card).some((color) => !commanderIdentity.has(color)),
      );
      if (invalid) {
        errors.push(
          `Deck contains cards outside commander color identity: ${invalid.identity.name}`,
        );
      }
    }
  }

  return { legal: errors.length === 0, errors };
}

/**
 * Returns all formats the deck is legal in.
 * Mirrors Forge's GameFormat.Collection.getAllFormatsOfDeck().
 */
export function inferFormats(cardNames: string[]): GameFormat[] {
  return GAME_FORMATS.filter((f) => validateDeck(cardNames, f).legal);
}

export function inferFormatsFromDeck(deck: Deck): GameFormat[] {
  return GAME_FORMATS.filter((format) => validateDeckSections({ deck }, format).legal);
}

/** Whether a deck should be analyzed as Commander (combos, bracket). The stored
 *  format is the primary signal, but legacy/imported decks often land as
 *  "standard" with no commander, so a ~100-card singleton shape is accepted as
 *  a fallback. */
export function looksLikeCommanderDeck(deck: Deck): boolean {
  if (getFormat(deck.format ?? "")?.deckRules.requiresCommander) return true;
  if ((deck.commanders?.length ?? 0) > 0) return true;
  const total = deck.cards.length + (deck.commanders?.length ?? 0);
  if (total < 90) return false;
  const counts = new Map<string, number>();
  for (const card of deck.cards) {
    if (canHaveAnyNumberOf(card)) continue;
    counts.set(card.identity.name, (counts.get(card.identity.name) ?? 0) + 1);
  }
  return [...counts.values()].every((n) => n === 1);
}
