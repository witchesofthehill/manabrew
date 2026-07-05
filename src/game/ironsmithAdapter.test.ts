import { describe, expect, it } from "vitest";

import {
  buildIronsmithDeckSources,
  mapIronsmithPrompt,
  mapIronsmithSnapshotToGameView,
  mapPromptOutputToIronsmithCommand,
  type IronsmithPromptMapping,
} from "./ironsmithAdapter";
import type { PromptOutput } from "@/protocol";
import type { DeckCard } from "@/protocol/deck";

function promptMapping(snapshot: unknown, promptId = "prompt-1"): IronsmithPromptMapping {
  const result = mapIronsmithPrompt(snapshot, promptId);
  if (!result || "message" in result) {
    throw new Error(`Expected prompt mapping, got ${JSON.stringify(result)}`);
  }
  return result;
}

function card(name: string, overrides: Partial<DeckCard> = {}): DeckCard {
  return {
    identity: { id: name.toLowerCase(), name, setCode: "TST", cardNumber: "1" },
    uris: { small: "", normal: "", large: "", png: "", art_crop: "", border_crop: "" },
    color: "G",
    colorIdentity: ["G"],
    manaCost: "{1}{G}",
    cmc: 2,
    types: ["Creature"],
    subtypes: ["Bear"],
    supertypes: [],
    keywords: [],
    power: "2",
    toughness: "2",
    text: "",
    ...overrides,
  };
}

describe("Ironsmith snapshot mapping", () => {
  it("maps visible public state while preserving hidden opponent hand privacy", () => {
    const view = mapIronsmithSnapshotToGameView({
      snapshot_id: "snapshot-a",
      turn_number: 3,
      step: "precombat main",
      active_player: 0,
      priority_player: 1,
      players: [
        {
          id: 0,
          name: "Alice",
          life: 18,
          can_view_hand: true,
          hand_cards: [{ id: 11, name: "Forest", mana_cost: "", card_types: ["Land"] }],
          graveyard_cards: [{ id: 12, name: "Opt" }],
          command_cards: [{ id: 13, name: "Kellan" }],
          battlefield: [
            {
              id: 21,
              name: "Llanowar Elves",
              tapped: true,
              counters: [{ kind: "+1/+1", amount: 2 }],
              power_toughness: "1/1",
            },
          ],
          library_size: 42,
          mana_pool: { green: 1 },
        },
        {
          id: 1,
          name: "Bob",
          life: 17,
          hand_size: 2,
          battlefield: [{ id: 22, name: "Island", lane: "land" }],
          exile_cards: [{ id: 23, name: "Lightning Bolt" }],
          library_size: 40,
          mana_pool: { blue: 1, colorless: 2 },
        },
      ],
      stack_objects: [
        {
          id: 31,
          controller: 0,
          name: "Shock",
          inspect_object_id: 11,
          targets: [{ kind: "player", player: 1 }],
        },
      ],
      game_over: { kind: "winner", player: 0 },
    });

    expect(view.gameId).toBe("ironsmith-snapshot-a");
    expect(view.turn).toBe(3);
    expect(view.step).toBe("main1");
    expect(view.activePlayerId).toBe("player-0");
    expect(view.priorityPlayerId).toBe("player-1");
    expect(view.players[0]?.hand[0]?.identity.name).toBe("Forest");
    expect(view.players[1]?.hand).toHaveLength(2);
    expect(view.players[1]?.hand.map((card) => card.identity.name)).toEqual([
      "Hidden Card",
      "Hidden Card",
    ]);
    expect(JSON.stringify(view.players[1]?.hand)).not.toContain("Counterspell");
    expect(view.battlefield.map((card) => card.id)).toEqual(["card-21", "card-22"]);
    expect(view.battlefield[0]?.tapped).toBe(true);
    expect(view.battlefield[0]?.counters["+1/+1"]).toBe(2);
    expect(view.stack[0]?.targets).toEqual([{ kind: "player", id: "player-1" }]);
    expect(view.gameOver).toBe(true);
    expect(view.winnerId).toBe("player-0");
  });
});

describe("Ironsmith deck source mapping", () => {
  it("builds unique external card source blocks from Manabrew deck cards", () => {
    const sources = buildIronsmithDeckSources([
      {
        name: "Smoke",
        format: "standard",
        cards: [
          card("Grizzly Bears"),
          card("Mountain", {
            color: "",
            colorIdentity: [],
            manaCost: "",
            cmc: 0,
            types: ["Land"],
            subtypes: ["Mountain"],
            supertypes: ["Basic"],
            power: undefined,
            toughness: undefined,
            text: "({T}: Add {R}.)",
          }),
          card("Grizzly Bears"),
        ],
        sideboard: [
          card("Lightning Bolt", {
            color: "R",
            colorIdentity: ["R"],
            manaCost: "{R}",
            cmc: 1,
            types: ["Instant"],
            subtypes: [],
            power: undefined,
            toughness: undefined,
            text: "Lightning Bolt deals 3 damage to any target.",
          }),
        ],
      },
    ]);

    expect(sources).toHaveLength(3);
    expect(sources[0]).toMatchObject({
      canonicalName: "Grizzly Bears",
      group: {
        kind: "single",
        name: "Grizzly Bears",
        block: "Mana cost: {1}{G}\nType: Creature \u2014 Bear\nPower/Toughness: 2/2",
      },
    });
    expect(sources[1]?.group.block).toBe("Type: Basic Land \u2014 Mountain\n({T}: Add {R}.)");
    expect(sources[2]?.group.block).toBe(
      "Mana cost: {R}\nType: Instant\nLightning Bolt deals 3 damage to any target.",
    );
  });
});

describe("Ironsmith prompt mapping", () => {
  it("maps priority actions to Manabrew's non-modal action prompt", () => {
    const mapping = promptMapping({
      decision: {
        kind: "priority",
        player: 0,
        actions: [
          { label: "Pass", action_ref: { kind: "pass_priority" } },
          { label: "Cast Bear", object_id: 101, action_ref: { kind: "cast_spell", spell_id: 101 } },
          { label: "Play Forest", object_id: 102, action_ref: { kind: "play_land", land_id: 102 } },
          {
            label: "Activate Elf",
            object_id: 201,
            ability_index: 2,
            action_ref: { kind: "activate_mana_ability", source: 201 },
          },
          {
            label: "Special play",
            action_ref: { kind: "special_action", action: { kind: "play_land", card_id: 301 } },
          },
        ],
      },
    });

    expect(mapping.forPlayer).toBe("player-0");
    expect(mapping.prompt.input.type).toBe("chooseAction");
    if (mapping.prompt.input.type !== "chooseAction") {
      throw new Error("expected chooseAction");
    }
    expect(mapping.prompt.input.actions).toEqual([
      {
        id: "1",
        type: "cast",
        cardId: "card-101",
        mode: "normal",
        modeLabel: "Cast",
      },
      {
        id: "2",
        type: "cast",
        cardId: "card-102",
        mode: "playLand",
        modeLabel: "Play",
      },
      {
        id: "3",
        type: "activateAbility",
        cardId: "card-201",
        abilityIndex: 2,
        description: "Activate Elf",
        isManaAbility: true,
      },
      {
        id: "4",
        type: "cast",
        cardId: "card-301",
        mode: "playLand",
        modeLabel: "Special",
      },
    ]);

    const command = mapPromptOutputToIronsmithCommand(
      {
        type: "chooseAction",
        output: { type: "act", actionId: "2" },
      },
      mapping.binding,
    );
    expect(command).toEqual({
      type: "priority_action",
      action_ref: { kind: "play_land", land_id: 102 },
    });

    const pass = mapPromptOutputToIronsmithCommand(
      {
        type: "chooseAction",
        output: { type: "pass" },
      },
      mapping.binding,
    );
    expect(pass).toEqual({ type: "priority_action", action_ref: { kind: "pass_priority" } });

    const legacyPassId = mapPromptOutputToIronsmithCommand(
      { type: "chooseAction", output: { type: "act", actionId: "PassPriority" } },
      mapping.binding,
    );
    expect(legacyPassId).toEqual({
      type: "priority_action",
      action_ref: { kind: "pass_priority" },
    });
  });

  it("normalizes legacy string pass action refs before dispatching to Ironsmith", () => {
    const mapping = promptMapping({
      decision: {
        kind: "priority",
        player: 0,
        actions: [{ label: "Pass", action_ref: "PassPriority" }],
      },
    });

    const pass = mapPromptOutputToIronsmithCommand(
      {
        type: "chooseAction",
        output: { type: "pass" },
      },
      mapping.binding,
    );
    expect(pass).toEqual({ type: "priority_action", action_ref: { kind: "pass_priority" } });
  });

  it("maps opening hand choices to Manabrew's mulligan prompt", () => {
    const mapping = promptMapping({
      decision: {
        kind: "priority",
        player: 0,
        actions: [
          {
            label: "Keep hand",
            kind: "pass_priority",
            action_ref: { kind: "keep_opening_hand" },
          },
          {
            label: "Mulligan",
            kind: "take_mulligan",
            action_ref: { kind: "take_mulligan" },
          },
        ],
      },
    });

    const keep = mapPromptOutputToIronsmithCommand(
      { type: "mulligan", output: { type: "mulliganDecision", keep: true } },
      mapping.binding,
    );

    expect(mapping.prompt.input.type).toBe("mulligan");
    expect(keep).toEqual({
      type: "priority_action",
      action_ref: { kind: "keep_opening_hand" },
    });

    const mulligan = mapPromptOutputToIronsmithCommand(
      { type: "mulligan", output: { type: "mulliganDecision", keep: false } },
      mapping.binding,
    );

    expect(mulligan).toEqual({
      type: "priority_action",
      action_ref: { kind: "take_mulligan" },
    });
  });

  it("matches legacy Manabrew action ids against current Ironsmith action refs", () => {
    const mapping = promptMapping({
      decision: {
        kind: "priority",
        player: 0,
        actions: [
          { label: "Cast Bear", object_id: 101, action_ref: { kind: "cast_spell", spell_id: 101 } },
          { label: "Play Forest", object_id: 102, action_ref: { kind: "play_land", land_id: 102 } },
          {
            label: "Tap Island",
            object_id: 201,
            ability_index: 0,
            action_ref: { kind: "activate_mana_ability", source: 201, ability_index: 0 },
          },
          {
            label: "Activate Elf",
            object_id: 202,
            ability_index: 2,
            action_ref: { kind: "activate_ability", source: 202, ability_index: 2 },
          },
          {
            label: "Untap Island",
            object_id: 201,
            action_ref: { kind: "untap_land", stable_id: 201 },
          },
        ],
      },
    });

    expect(
      mapPromptOutputToIronsmithCommand(
        { type: "chooseAction", output: { type: "act", actionId: "cast:card-101:normal" } },
        mapping.binding,
      ),
    ).toEqual({ type: "priority_action", action_ref: { kind: "cast_spell", spell_id: 101 } });
    expect(
      mapPromptOutputToIronsmithCommand(
        { type: "chooseAction", output: { type: "act", actionId: "cast:card-102:normal" } },
        mapping.binding,
      ),
    ).toEqual({ type: "priority_action", action_ref: { kind: "play_land", land_id: 102 } });
    expect(
      mapPromptOutputToIronsmithCommand(
        { type: "chooseAction", output: { type: "act", actionId: "tap:card-201:0:U" } },
        mapping.binding,
      ),
    ).toEqual({
      type: "priority_action",
      action_ref: { kind: "activate_mana_ability", source: 201, ability_index: 0 },
    });
    expect(
      mapPromptOutputToIronsmithCommand(
        { type: "chooseAction", output: { type: "act", actionId: "ability:card-202:2" } },
        mapping.binding,
      ),
    ).toEqual({
      type: "priority_action",
      action_ref: { kind: "activate_ability", source: 202, ability_index: 2 },
    });
    expect(
      mapPromptOutputToIronsmithCommand(
        { type: "chooseAction", output: { type: "act", actionId: "untap:card-201" } },
        mapping.binding,
      ),
    ).toEqual({ type: "priority_action", action_ref: { kind: "untap_land", stable_id: 201 } });
  });

  it("keeps priority non-modal while Ironsmith is collecting mana payment", () => {
    const mapping = promptMapping({
      mana_payment: {},
      decision: {
        kind: "priority",
        player: 0,
        actions: [
          { label: "Cast Bear", object_id: 101, action_ref: { kind: "cast_spell", spell_id: 101 } },
        ],
      },
    });

    expect(mapping.prompt.input.type).toBe("chooseAction");
    if (mapping.prompt.input.type !== "chooseAction") {
      throw new Error("expected chooseAction");
    }
    expect(mapping.prompt.input.actions).toEqual([
      {
        id: "0",
        type: "cast",
        cardId: "card-101",
        mode: "normal",
        modeLabel: "Cast",
      },
    ]);
  });

  it("maps numeric, option, card, and target decisions back to UiCommand shapes", () => {
    const number = promptMapping({
      decision: { kind: "number", player: 1, min: 1, max: 5, description: "Choose X" },
    });
    expect(number.prompt.input.type).toBe("chooseNumber");
    expect(
      mapPromptOutputToIronsmithCommand(
        { type: "chooseNumber", output: { type: "numberDecision", chosenNumber: 3 } },
        number.binding,
      ),
    ).toEqual({ type: "number_choice", value: 3 });

    const colors = promptMapping({
      decision: {
        kind: "select_options",
        player: 1,
        min: 1,
        max: 2,
        options: [
          { index: 4, description: "Red" },
          { index: 7, description: "Green" },
        ],
      },
    });
    expect(colors.prompt.input.type).toBe("chooseColor");
    expect(
      mapPromptOutputToIronsmithCommand(
        { type: "chooseColor", output: { type: "colorDecision", chosenColors: { R: 1, G: 1 } } },
        colors.binding,
      ),
    ).toEqual({ type: "select_options", option_indices: [4, 7] });

    const boolean = promptMapping({
      decision: {
        kind: "select_options",
        player: 1,
        min: 1,
        max: 1,
        options: [
          { index: 9, description: "Yes" },
          { index: 10, description: "No" },
        ],
      },
    });
    expect(boolean.prompt.input.type).toBe("chooseBoolean");
    expect(
      mapPromptOutputToIronsmithCommand(
        { type: "chooseBoolean", output: { type: "decision", value: false } },
        boolean.binding,
      ),
    ).toEqual({ type: "select_options", option_indices: [10] });

    const cards = promptMapping({
      decision: {
        kind: "select_objects",
        player: 0,
        min: 1,
        max: 1,
        candidates: [
          { id: 77, name: "Target Card" },
          { id: 78, name: "Other Card" },
        ],
      },
    });
    expect(cards.prompt.input.type).toBe("chooseCards");
    expect(
      mapPromptOutputToIronsmithCommand(
        {
          type: "chooseCards",
          output: { type: "chooseCardsDecision", chosenCardIds: ["card-77"] },
        },
        cards.binding,
      ),
    ).toEqual({ type: "select_objects", object_ids: [77] });

    const targets = promptMapping({
      decision: {
        kind: "targets",
        player: 0,
        context: "Choose targets",
        requirements: [
          {
            min_targets: 1,
            max_targets: 2,
            legal_targets: [
              { kind: "player", player: 1 },
              { kind: "object", object: 77 },
            ],
          },
        ],
      },
    });
    expect(targets.prompt.input.type).toBe("chooseBoardTargets");
    expect(
      mapPromptOutputToIronsmithCommand(
        {
          type: "chooseBoardTargets",
          output: {
            type: "boardTargets",
            chosen: [
              { kind: "player", id: "player-1" },
              { kind: "card", id: "card-77" },
            ],
          },
        },
        targets.binding,
      ),
    ).toEqual({
      type: "select_targets",
      targets: [
        { kind: "player", player: 1 },
        { kind: "object", object: 77 },
      ],
    });
  });

  it("maps reorder and combat decisions", () => {
    const reorder = promptMapping({
      decision: {
        kind: "select_objects",
        player: 0,
        selection_identity: "library_order",
        candidates: [
          { id: 40, name: "First" },
          { id: 41, name: "Second" },
        ],
      },
    });
    expect(reorder.prompt.input.type).toBe("reorderCards");
    expect(
      mapPromptOutputToIronsmithCommand(
        {
          type: "reorderCards",
          output: { type: "reorderDecision", orderedCardIds: ["card-41", "card-40"] },
        },
        reorder.binding,
      ),
    ).toEqual({ type: "select_objects", object_ids: [41, 40] });

    const attackers = promptMapping({
      decision: {
        kind: "attackers",
        player: 0,
        attacker_options: [
          { creature: 50, valid_targets: [{ kind: "player", player: 1, name: "Bob" }] },
          { creature: 51, valid_targets: [{ kind: "object", object: 91, name: "Jace" }] },
        ],
      },
    });
    expect(attackers.prompt.input.type).toBe("chooseAttackers");
    expect(
      mapPromptOutputToIronsmithCommand(
        {
          type: "chooseAttackers",
          output: {
            type: "declareAttackers",
            assignments: [
              { attackerId: "card-50", targetId: "player-1" },
              { attackerId: "card-51", targetId: "card-91" },
            ],
          },
        },
        attackers.binding,
      ),
    ).toEqual({
      type: "declare_attackers",
      declarations: [
        { creature: 50, target: { kind: "player", player: 1 } },
        { creature: 51, target: { kind: "planeswalker", object: 91 } },
      ],
    });

    const blockers = promptMapping({
      decision: {
        kind: "blockers",
        player: 1,
        blocker_options: [
          { attacker: 50, valid_blockers: [{ id: 60 }, { id: 61 }], min_blockers: 0 },
        ],
      },
    });
    expect(blockers.prompt.input.type).toBe("chooseBlockers");
    expect(
      mapPromptOutputToIronsmithCommand(
        {
          type: "chooseBlockers",
          output: {
            type: "declareBlockers",
            assignments: [{ blockerId: "card-60", attackerId: "card-50" }],
          },
        },
        blockers.binding,
      ),
    ).toEqual({
      type: "declare_blockers",
      declarations: [{ blocker: 60, blocking: 50 }],
    });
  });

  it("turns unsupported text input into a targeted fatal prompt", () => {
    const result = mapIronsmithPrompt(
      { decision: { kind: "text_input", player: 1, description: "Name a card" } },
      "prompt-1",
    );
    expect(result).toEqual({ forPlayer: "player-1", message: "Name a card" });
  });

  it("maps concede responses without needing an Ironsmith action_ref", () => {
    const binding = promptMapping({
      decision: { kind: "priority", player: 0, actions: [] },
    }).binding;
    const output: PromptOutput = { type: "chooseAction", output: { type: "concede" } };
    expect(mapPromptOutputToIronsmithCommand(output, binding)).toEqual({ type: "forfeit_player" });
  });
});
