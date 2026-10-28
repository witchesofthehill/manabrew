import { describe, expect, it } from "vitest";
import { deriveCardPresentation } from "@/components/game/cardPresentation";
import { getDisplayedManaAbilities } from "@/components/game/manaUtils";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import type { CardDto, ManaColor } from "@/protocol/game";
import type { HandActionOption } from "@/stores/useGameUIStore";
import {
  actionRowText,
  activatedRulesEntries,
  resolveRulesPreviewDisplay,
  rulesEntryMatchesStackAbility,
  rulesTextEntries,
  stackHighlightEntry,
} from "./rulesCardPreviewPresentation";

const identity = (text: string) => text;

function oracleEntries(oracle: string): string[] {
  return rulesTextEntries(oracle, null);
}

function ability(
  description: string,
  cost: string,
  extra: Partial<HandActionOption> = {},
): HandActionOption {
  return { kind: "ability", cardId: "card-1", abilityIndex: 0, label: description, cost, ...extra };
}

function manaOptions(description: string, cost: string, color: ManaColor): HandActionOption[] {
  return getDisplayedManaAbilities("card-1", [
    {
      cardId: "card-1",
      abilityIndex: 0,
      description,
      isManaAbility: true,
      cost,
      producedMana: [{ color, amount: 1 }],
    },
  ]).map((option) => ({
    kind: "ability",
    cardId: option.cardId,
    abilityIndex: option.abilityIndex,
    label: option.description,
    isManaAbility: true,
    cost: option.cost,
    displayManaLetters: option.displayManaLetters,
    abilityText: description,
  }));
}

function pair(actions: HandActionOption[], oracle: string) {
  const entries = oracleEntries(oracle);
  const rows = actions.map((action) => ({ action, displayLabel: action.label }));
  const matches = activatedRulesEntries(rows, entries, identity);
  return {
    hidden: [...new Set(matches.values())],
    rows: rows.map((row, index) =>
      actionRowText(row.action, matches.get(index) ?? row.displayLabel),
    ),
  };
}

function card(overrides: Partial<CardDto>): CardDto {
  return {
    ...GAME_CARD_DEFAULTS,
    id: "card-1",
    identity: { name: "Test Card", setCode: "", cardNumber: "", isToken: false },
    ...overrides,
  };
}

function keywordChips(overrides: Partial<CardDto>): string[] {
  const live = card(overrides);
  return resolveRulesPreviewDisplay({
    card: live,
    presentation: deriveCardPresentation(live),
    info: null,
    showBackFace: false,
    faceless: false,
  }).keywords;
}

const HERMIT_DRUID =
  "{G}, {T}: Reveal cards from the top of your library until you reveal a basic land card. Put that card into your hand and all other cards revealed this way into your graveyard.";
const SWAMP = "({T}: Add {B}.)";
const OVERGROWN_TOMB =
  "({T}: Add {B} or {G}.)\nAs Overgrown Tomb enters, you may pay 2 life. If you don't, it enters tapped.";
const RAUGRIN_TRIOME =
  "({T}: Add {U}, {R}, or {W}.)\nRaugrin Triome enters tapped.\nCycling {3} ({3}, Discard this card: Draw a card.)";
const SLICKSHOT_SHOW_OFF =
  "Flying, haste\nWhenever you cast a noncreature spell, Slickshot Show-Off gets +2/+0 until end of turn.\nPlot {1}{R} (You may pay {1}{R} and exile this card from your hand. Cast it as a sorcery on a later turn without paying its mana cost. Plot only as a sorcery.)";
const PLOT_DESCRIPTION =
  "Plot (You may pay {1}{R} and exile this card from your hand. Cast it as a sorcery on a later turn without paying its mana cost. Plot only as a sorcery.)";

describe("ability actions and their Oracle paragraphs", () => {
  it("shows Hermit Druid's activated ability once, with its printed cost", () => {
    const result = pair([ability(HERMIT_DRUID, "{G}, {T}")], HERMIT_DRUID);
    expect(result.hidden).toEqual([HERMIT_DRUID]);
    expect(result.rows).toEqual([HERMIT_DRUID]);
  });

  it("hides a basic land's mana reminder behind its tap option", () => {
    const result = pair(manaOptions("{T}: Add {B}.", "{T}", "B"), SWAMP);
    expect(result.hidden).toEqual([SWAMP]);
    expect(result.rows).toEqual(["{T}: Add {B}"]);
  });

  it("hides a dual land's reminder behind both basic land type abilities", () => {
    const actions = [
      ...manaOptions("{T}: Add {B}.", "{T}", "B"),
      ...manaOptions("{T}: Add {G}.", "{T}", "G"),
    ];
    const result = pair(actions, OVERGROWN_TOMB);
    expect(result.hidden).toEqual(["({T}: Add {B} or {G}.)"]);
    expect(result.rows).toEqual(["{T}: Add {B}", "{T}: Add {G}"]);
  });

  it("hides a triome's reminder behind all three basic land type abilities", () => {
    const actions = [
      ...manaOptions("{T}: Add {U}.", "{T}", "U"),
      ...manaOptions("{T}: Add {R}.", "{T}", "R"),
      ...manaOptions("{T}: Add {W}.", "{T}", "W"),
    ];
    expect(pair(actions, RAUGRIN_TRIOME).hidden).toEqual(["({T}: Add {U}, {R}, or {W}.)"]);
  });

  it("does not match a mana ability whose color the land line does not offer", () => {
    expect(pair(manaOptions("{T}: Add {R}.", "{T}", "R"), OVERGROWN_TOMB).hidden).toEqual([]);
  });

  it("shows Plot once, in its printed keyword form", () => {
    const plot = SLICKSHOT_SHOW_OFF.split("\n")[2]!;
    const result = pair([ability(PLOT_DESCRIPTION, "{1}{R}")], SLICKSHOT_SHOW_OFF);
    expect(result.hidden).toEqual([plot]);
    expect(result.rows).toEqual([plot]);
  });

  it("keeps the cost in front of an unmatched Plot action", () => {
    const result = pair([ability(PLOT_DESCRIPTION, "{1}{R}")], "Flying, haste");
    expect(result.hidden).toEqual([]);
    expect(result.rows).toEqual([`{1}{R}: ${PLOT_DESCRIPTION}`]);
  });

  it("does not match a paragraph with a different cost", () => {
    const result = pair([ability("{3}, {T}: Draw a card.", "{3}, {T}")], "{4}, {T}: Draw a card.");
    expect(result.hidden).toEqual([]);
  });
});

describe("keyword chips", () => {
  it("shows no chip for Firebolt's printed mana flashback", () => {
    expect(
      keywordChips({
        text: "Firebolt deals 2 damage to any target.\nFlashback {4}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
        keywords: ["Flashback:4 R"],
        keywordLabels: { "Flashback:4 R": "Flashback" },
        flashbackCost: "4 R",
      }),
    ).toEqual([]);
  });

  it("shows no chip for Lava Dart's printed non-mana flashback", () => {
    expect(
      keywordChips({
        text: "Lava Dart deals 1 damage to any target.\nFlashback—Sacrifice a Mountain. (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
        keywords: ["Flashback:Sac<1/Mountain>"],
        flashbackCost: "Sac<1/Mountain>",
      }),
    ).toEqual([]);
  });

  it("shows a granted keyword with the producer's title", () => {
    expect(
      keywordChips({
        text: HERMIT_DRUID,
        keywords: ["Flying"],
        keywordLabels: { Flying: "Flying" },
        grantedKeywords: ["Flying"],
      }),
    ).toEqual(["Flying"]);
  });

  it("formats a granted keyword without a title from its raw cost", () => {
    expect(
      keywordChips({
        text: "Lava Dart deals 1 damage to any target.",
        keywords: ["Flashback:4 R", "Flashback:Sac<1/Mountain>"],
        grantedKeywords: ["Flashback:4 R", "Flashback:Sac<1/Mountain>"],
      }),
    ).toEqual(["Flashback {4}{R}", "Flashback"]);
  });
});

describe("stack ability highlight", () => {
  const WRITHING_CHRYSALIS_ORACLE =
    'Devoid (This card has no color.)\nWhen you cast this spell, create two 0/1 colorless Eldrazi Spawn creature tokens with "Sacrifice this token: Add {C}."\nReach\nWhenever you sacrifice another Eldrazi, put a +1/+1 counter on this creature.';
  const entries = oracleEntries(WRITHING_CHRYSALIS_ORACLE);

  it("highlights Writhing Chrysalis's cast trigger despite newer Oracle wording", () => {
    const forgeTrigger =
      'When you cast this spell, create two 0/1 colorless Eldrazi Spawn creature tokens with "Sacrifice this creature: Add {C}."';
    expect(entries.some((entry) => rulesEntryMatchesStackAbility(entry, forgeTrigger))).toBe(false);
    expect(stackHighlightEntry(forgeTrigger, entries)).toBe(entries[1]);
  });

  it("highlights the closest trigger, not another trigger on the same card", () => {
    const forgeTrigger =
      "Whenever you sacrifice another Eldrazi, put a +1/+1 counter on Writhing Chrysalis.";
    expect(stackHighlightEntry(forgeTrigger, entries)).toBe(entries[3]);
  });

  it("leaves exact matches to the exact rule", () => {
    const hermitDruid = oracleEntries(HERMIT_DRUID);
    const sourceAbility = HERMIT_DRUID;
    expect(rulesEntryMatchesStackAbility(hermitDruid[0]!, sourceAbility)).toBe(true);
    expect(stackHighlightEntry(sourceAbility, hermitDruid)).toBeNull();
  });
});
