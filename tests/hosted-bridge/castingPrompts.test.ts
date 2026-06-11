import { afterEach, describe, expect, it } from "vitest";

import {
  card,
  findAction,
  HostedHarness,
  type HostedPrompt,
  type HostedSnapshot,
  type PromptResult,
} from "./hostedClient";

type PriorityPrompt = HostedPrompt & {
  actions: Array<{ index: number; label?: string; kind?: string; cardId?: string; cost?: string }>;
};

const opponentDeck = [
  card("Mountain"),
  card("Mountain"),
  card("Mountain"),
  card("Mountain"),
  card("Mountain"),
  card("Mountain"),
  card("Mountain"),
  card("Mountain"),
];

let harness: HostedHarness | null = null;

afterEach(async () => {
  if (harness) {
    await harness.close();
    harness = null;
  }
});

function simianSpiritGuides(count: number) {
  return Array.from({ length: count }, () => card("Simian Spirit Guide"));
}

function blackLotuses(count: number) {
  return Array.from({ length: count }, () => card("Black Lotus"));
}

async function startAtOpeningPriority(deck: Array<{ name: string }>, opponent = opponentDeck) {
  const candidate = HostedHarness.launch();
  const handle = await candidate.startGame({
    gameId: `hosted-bridge-${Date.now()}`,
    startingLife: 20,
    seed: 1,
    players: [
      { name: "Tester", ai: false, deck },
      { name: "Opponent", ai: true, deck: opponent },
    ],
  });
  let cursor = await candidate.waitForPrompt(handle.sessionId);
  if (cursor.prompt.kind === "first_player_roll") {
    await candidate.submitAction(handle.sessionId, { kind: "first_player_roll_acknowledged" });
    cursor = await candidate.waitForPrompt(handle.sessionId, {
      kind: "mulligan",
      afterRaw: cursor.raw,
    });
  }
  expect(cursor.prompt.kind).toBe("mulligan");
  await candidate.submitAction(handle.sessionId, { kind: "mulligan_decision", keep: true });
  const priority = await candidate.waitForPrompt<PriorityPrompt>(handle.sessionId, {
    kind: "priority",
    afterRaw: cursor.raw,
  });
  harness = candidate;
  return { sessionId: handle.sessionId, priority };
}

async function chooseAction(
  sessionId: string,
  current: PromptResult,
  actionIndex: number,
  kind?: string,
) {
  if (!harness) {
    throw new Error("harness not started");
  }
  await harness.submitAction(sessionId, { kind: "choose_action", index: actionIndex });
  return harness.waitForPrompt(sessionId, { kind, afterRaw: current.raw });
}

async function waitForGameOver(sessionId: string, timeoutMs = 10_000) {
  if (!harness) {
    throw new Error("harness not started");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await harness.getGameOver(sessionId)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for game over");
}

async function waitForSnapshot(
  sessionId: string,
  accepts: (snapshot: HostedSnapshot) => boolean,
  timeoutMs = 10_000,
) {
  if (!harness) {
    throw new Error("harness not started");
  }
  const deadline = Date.now() + timeoutMs;
  let last: HostedSnapshot | null = null;
  while (Date.now() < deadline) {
    last = await harness.getSnapshot(sessionId);
    if (accepts(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for snapshot; last=${JSON.stringify(last)}`);
}

function player(snapshot: HostedSnapshot, index: number) {
  const candidate = snapshot.players?.[index];
  if (!candidate) {
    throw new Error(`missing player ${index}`);
  }
  return candidate;
}

function playerLife(snapshot: HostedSnapshot, index: number) {
  const life = player(snapshot, index).life;
  if (typeof life !== "number") {
    throw new Error(`missing life for player ${index}`);
  }
  return life;
}

function zoneSize(snapshot: HostedSnapshot, index: number, zone: "hand" | "graveyard") {
  const cards = player(snapshot, index)[zone];
  return Array.isArray(cards) ? cards.length : 0;
}

async function passUntilAction(
  sessionId: string,
  current: PromptResult,
  cardName: string,
  kind = "spell",
  maxPasses = 40,
) {
  if (!harness) {
    throw new Error("harness not started");
  }
  let cursor = current;
  for (let i = 0; i < maxPasses; i += 1) {
    if (cursor.prompt.kind === "priority") {
      const actions = Array.isArray(cursor.prompt.actions) ? cursor.prompt.actions : [];
      if (
        actions.some(
          (action) =>
            action &&
            typeof action === "object" &&
            (action as { kind?: string }).kind === kind &&
            (action as { label?: string }).label?.includes(cardName),
        )
      ) {
        return cursor as PromptResult<PriorityPrompt>;
      }
      await harness.submitAction(sessionId, { kind: "pass" });
      cursor = await harness.waitForPrompt(sessionId, { kind: "priority", afterRaw: cursor.raw });
    } else {
      await harness.submitAction(sessionId, { kind: "pass" });
      cursor = await harness.waitForPrompt(sessionId, { afterRaw: cursor.raw });
    }
  }
  throw new Error(`did not reach priority with ${cardName}`);
}

async function castSpellAndReturnPriority(
  sessionId: string,
  current: PromptResult,
  cardName: string,
) {
  const spellPriority = await passUntilAction(sessionId, current, cardName, "spell");
  const action = findAction(spellPriority.prompt, cardName);
  return chooseAction(sessionId, spellPriority, action.index, "priority");
}

async function activatePriorityManaAbility(
  sessionId: string,
  current: PromptResult,
  cardName: string,
  color: string,
) {
  const manaPriority = await passUntilAction(sessionId, current, cardName, "mana");
  const action = findAction(manaPriority.prompt, cardName, "mana");
  if (cardName === "Black Lotus") {
    expect(action.cost).toMatch(/\bAny\b/);
  }
  await harness!.submitAction(sessionId, {
    kind: "tap_land",
    manaAbilityIndex: action.index,
    cardId: action.cardId,
    color,
  });
  const cursor = await harness!.waitForPrompt(sessionId, {
    kind: "confirm_action",
    afterRaw: manaPriority.raw,
  });
  const description =
    typeof cursor.prompt.description === "string" ? cursor.prompt.description : "";
  expect(description).toContain(cardName);
  expect(description).not.toContain("CARDNAME");
  await harness!.submitAction(sessionId, { kind: "boolean_decision", accept: true });
  return harness!.waitForPrompt<PriorityPrompt>(sessionId, {
    kind: "priority",
    afterRaw: cursor.raw,
  });
}

async function addBlackLotusMana(
  sessionId: string,
  current: PromptResult,
  count: number,
  color: string,
) {
  let cursor = current;
  for (let i = 0; i < count; i += 1) {
    cursor = await castSpellAndReturnPriority(sessionId, cursor, "Black Lotus");
    cursor = await activatePriorityManaAbility(sessionId, cursor, "Black Lotus", color);
  }
  return cursor;
}

async function castTormentForX(sessionId: string, current: PromptResult, xValue: number) {
  const tormentPriority = await passUntilAction(sessionId, current, "Torment of Hailfire");
  const action = findAction(tormentPriority.prompt, "Torment of Hailfire");
  let cursor = await chooseAction(sessionId, tormentPriority, action.index, "choose_number");
  await harness!.submitAction(sessionId, { kind: "number_decision", number: xValue });
  cursor = await harness!.waitForPrompt(sessionId, {
    kind: "pay_mana_cost",
    afterRaw: cursor.raw,
  });
  await harness!.submitAction(sessionId, { kind: "pay_mana" });
  await harness!.waitForPrompt<PriorityPrompt>(sessionId, {
    kind: "priority",
    afterRaw: cursor.raw,
  });
  await harness!.submitAction(sessionId, { kind: "pass" });
  return harness!.waitForPrompt<PriorityPrompt>(sessionId, {
    kind: "priority",
    afterRaw: cursor.raw,
    timeoutMs: 60_000,
  });
}

async function castSphinxForX(sessionId: string, current: PromptResult, xValue: number) {
  const sphinxPriority = await passUntilAction(sessionId, current, "Sphinx's Revelation");
  const action = findAction(sphinxPriority.prompt, "Sphinx's Revelation");
  let cursor = await chooseAction(sessionId, sphinxPriority, action.index, "choose_number");
  await harness!.submitAction(sessionId, { kind: "number_decision", number: xValue });
  cursor = await harness!.waitForPrompt(sessionId, {
    kind: "pay_mana_cost",
    afterRaw: cursor.raw,
  });
  await harness!.submitAction(sessionId, { kind: "pay_mana" });
  await harness!.waitForPrompt<PriorityPrompt>(sessionId, {
    kind: "priority",
    afterRaw: cursor.raw,
  });
  await harness!.submitAction(sessionId, { kind: "pass" });
  await waitForGameOver(sessionId);
  return harness!.getSnapshot(sessionId);
}

describe.sequential("hosted Forge casting prompt flow", () => {
  it("prompts for Demand Answers' additional discard/sacrifice cost before mana", async () => {
    const { sessionId, priority } = await startAtOpeningPriority([
      card("Demand Answers"),
      card("Demand Answers"),
      ...simianSpiritGuides(6),
    ]);

    const spellPriority = await passUntilAction(sessionId, priority, "Demand Answers");
    const action = findAction(spellPriority.prompt, "Demand Answers");
    const prompt = await chooseAction(sessionId, spellPriority, action.index);

    expect(prompt.prompt.kind).toBe("choose_cards_for_effect");
    expect(prompt.prompt.min).toBe(1);
    expect(prompt.prompt.max).toBe(1);
  });

  it("does not keep serving consumed priority after Demand Answers resolves to game over", async () => {
    const { sessionId, priority } = await startAtOpeningPriority([
      card("Demand Answers"),
      card("Demand Answers"),
      ...simianSpiritGuides(6),
    ]);

    const spellPriority = await passUntilAction(sessionId, priority, "Demand Answers");
    const action = findAction(spellPriority.prompt, "Demand Answers");
    let cursor = await chooseAction(
      sessionId,
      spellPriority,
      action.index,
      "choose_cards_for_effect",
    );

    const discard = Array.isArray(cursor.prompt.cards)
      ? cursor.prompt.cards.find(
          (candidate) =>
            candidate &&
            typeof candidate === "object" &&
            (candidate as { label?: string }).label === "Simian Spirit Guide",
        )
      : null;
    if (!discard || typeof discard !== "object" || !("id" in discard)) {
      throw new Error("missing Simian Spirit Guide discard option");
    }

    await harness!.submitAction(sessionId, {
      kind: "choose_cards",
      card_ids: [(discard as { id: string }).id],
    });
    cursor = await harness!.waitForPrompt(sessionId, {
      kind: "pay_mana_cost",
      afterRaw: cursor.raw,
    });

    for (let i = 0; i < 2; i += 1) {
      const sources = Array.isArray(cursor.prompt.manaAbilityOptions)
        ? cursor.prompt.manaAbilityOptions
        : [];
      const source = sources.find(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          (candidate as { description?: string }).description === "Simian Spirit Guide",
      );
      if (!source || typeof source !== "object") {
        throw new Error("missing Simian Spirit Guide mana source");
      }
      await harness!.submitAction(sessionId, {
        kind: "tap_land",
        cardId: (source as { cardId: string }).cardId,
        manaAbilityIndex: (source as { abilityIndex: number }).abilityIndex,
        color: "R",
      });
      cursor = await harness!.waitForPrompt(sessionId, {
        kind: "confirm_action",
        afterRaw: cursor.raw,
      });
      await harness!.submitAction(sessionId, { kind: "boolean_decision", accept: true });
      cursor = await harness!.waitForPrompt(sessionId, {
        kind: "pay_mana_cost",
        afterRaw: cursor.raw,
      });
    }

    await harness!.submitAction(sessionId, { kind: "pay_mana" });
    cursor = await harness!.waitForPrompt(sessionId, { kind: "priority", afterRaw: cursor.raw });
    const consumedPriority = cursor.raw;
    await harness!.submitAction(sessionId, { kind: "pass" });

    await waitForGameOver(sessionId);
    expect(await harness!.getPromptRaw(sessionId)).not.toBe(consumedPriority);
  });

  it("announces X for Banefire before targets or mana", async () => {
    const { sessionId, priority } = await startAtOpeningPriority([
      card("Banefire"),
      card("Banefire"),
      ...simianSpiritGuides(6),
    ]);

    const spellPriority = await passUntilAction(sessionId, priority, "Banefire");
    const action = findAction(spellPriority.prompt, "Banefire");
    const prompt = await chooseAction(sessionId, spellPriority, action.index);

    expect(prompt.prompt.kind).toBe("choose_number");
    expect(prompt.prompt.sourceCardName).toBe("Banefire");
    expect(prompt.prompt.description).toBe("Announce X");
  });

  it("prompts for optional kicker costs before Burst Lightning targets or mana", async () => {
    const { sessionId, priority } = await startAtOpeningPriority([
      card("Burst Lightning"),
      card("Burst Lightning"),
      ...simianSpiritGuides(6),
    ]);

    const spellPriority = await passUntilAction(sessionId, priority, "Burst Lightning");
    const action = findAction(spellPriority.prompt, "Burst Lightning");
    const prompt = await chooseAction(sessionId, spellPriority, action.index);

    expect(prompt.prompt.kind).toBe("choose_mode");
    expect(prompt.prompt.sourceCardName).toBe("Burst Lightning");
    expect(prompt.prompt.min).toBe(0);
    expect(prompt.prompt.max).toBeGreaterThanOrEqual(1);
    expect(prompt.prompt.options).toEqual(
      expect.arrayContaining([expect.stringContaining("Kicker")]),
    );
  });

  it("announces X for Sphinx's Revelation before mana", async () => {
    const { sessionId, priority } = await startAtOpeningPriority([
      card("Sphinx's Revelation"),
      card("Sphinx's Revelation"),
      ...blackLotuses(6),
    ]);

    let cursor = await castSpellAndReturnPriority(sessionId, priority, "Black Lotus");
    cursor = await castSpellAndReturnPriority(sessionId, cursor, "Black Lotus");
    cursor = await activatePriorityManaAbility(sessionId, cursor, "Black Lotus", "W");
    cursor = await activatePriorityManaAbility(sessionId, cursor, "Black Lotus", "U");
    const sphinxPriority = await passUntilAction(sessionId, cursor, "Sphinx's Revelation");
    const action = findAction(sphinxPriority.prompt, "Sphinx's Revelation");
    const prompt = await chooseAction(sessionId, sphinxPriority, action.index);

    expect(prompt.prompt.kind).toBe("choose_number");
    expect(prompt.prompt.sourceCardName).toBe("Sphinx's Revelation");
    expect(prompt.prompt.description).toBe("Announce X");
  });

  it("marks self-decking Sphinx's Revelation as a loss", async () => {
    const { sessionId, priority } = await startAtOpeningPriority([
      card("Sphinx's Revelation"),
      card("Sphinx's Revelation"),
      ...blackLotuses(6),
    ]);

    let cursor = await castSpellAndReturnPriority(sessionId, priority, "Black Lotus");
    cursor = await castSpellAndReturnPriority(sessionId, cursor, "Black Lotus");
    cursor = await activatePriorityManaAbility(sessionId, cursor, "Black Lotus", "W");
    cursor = await activatePriorityManaAbility(sessionId, cursor, "Black Lotus", "U");
    const snapshot = await castSphinxForX(sessionId, cursor, 2);

    expect(snapshot.game_over).toBe(true);
    expect(snapshot.winner).toBe(1);
    expect(player(snapshot, 0).has_lost).toBe(true);
  });

  it("announces X for Torment of Hailfire before mana", async () => {
    const { sessionId, priority } = await startAtOpeningPriority([
      card("Torment of Hailfire"),
      card("Torment of Hailfire"),
      ...blackLotuses(6),
    ]);

    let cursor = await castSpellAndReturnPriority(sessionId, priority, "Black Lotus");
    cursor = await activatePriorityManaAbility(sessionId, cursor, "Black Lotus", "B");
    const tormentPriority = await passUntilAction(sessionId, cursor, "Torment of Hailfire");
    const action = findAction(tormentPriority.prompt, "Torment of Hailfire");
    const prompt = await chooseAction(sessionId, tormentPriority, action.index);

    expect(prompt.prompt.kind).toBe("choose_number");
    expect(prompt.prompt.sourceCardName).toBe("Torment of Hailfire");
    expect(prompt.prompt.description).toBe("Announce X");
  });

  it("uses selected Black Lotus priority mana color without a second color prompt", async () => {
    const { sessionId, priority } = await startAtOpeningPriority([
      card("Torment of Hailfire"),
      card("Torment of Hailfire"),
      ...blackLotuses(6),
    ]);

    let cursor = await castSpellAndReturnPriority(sessionId, priority, "Black Lotus");
    cursor = await activatePriorityManaAbility(sessionId, cursor, "Black Lotus", "B");
    const actions = Array.isArray(cursor.prompt.actions) ? cursor.prompt.actions : [];

    expect(cursor.prompt.kind).toBe("priority");
    expect(
      actions.some(
        (action) => action.kind === "spell" && action.label?.includes("Torment of Hailfire"),
      ),
    ).toBe(true);
  });

  it("resolves Torment of Hailfire empty-hand life loss choices", async () => {
    const { sessionId, priority } = await startAtOpeningPriority([
      card("Torment of Hailfire"),
      card("Torment of Hailfire"),
      ...blackLotuses(6),
    ]);

    let cursor = await addBlackLotusMana(sessionId, priority, 3, "B");
    cursor = await castTormentForX(sessionId, cursor, 6);
    const afterDiscard = await waitForSnapshot(
      sessionId,
      (snapshot) => zoneSize(snapshot, 1, "hand") === 0 && zoneSize(snapshot, 1, "graveyard") === 6,
    );

    expect(playerLife(afterDiscard, 1)).toBe(20);

    cursor = await addBlackLotusMana(sessionId, cursor, 1, "B");
    await castTormentForX(sessionId, cursor, 1);
    const afterLifeLoss = await waitForSnapshot(
      sessionId,
      (snapshot) => playerLife(snapshot, 1) === 17 && zoneSize(snapshot, 1, "hand") === 0,
    );

    expect(zoneSize(afterLifeLoss, 1, "graveyard")).toBe(6);
  });

  it("preserves optional target counts for Jaya's Immolating Inferno", async () => {
    const { sessionId, priority } = await startAtOpeningPriority([
      card("Rograkh, Son of Rohgahh"),
      card("Rograkh, Son of Rohgahh"),
      card("Jaya's Immolating Inferno"),
      card("Jaya's Immolating Inferno"),
      ...simianSpiritGuides(4),
    ]);

    const rograkhPriority = await passUntilAction(sessionId, priority, "Rograkh, Son of Rohgahh");
    const rograkh = findAction(rograkhPriority.prompt, "Rograkh, Son of Rohgahh");
    const stackPriority = await chooseAction(sessionId, rograkhPriority, rograkh.index, "priority");
    const jayaPriority = await passUntilAction(
      sessionId,
      stackPriority,
      "Jaya's Immolating Inferno",
    );
    const jaya = findAction(jayaPriority.prompt, "Jaya's Immolating Inferno");
    const announce = await chooseAction(sessionId, jayaPriority, jaya.index, "choose_number");

    expect(announce.prompt.description).toBe("Announce X");
    await harness!.submitAction(sessionId, { kind: "number_decision", number: 0 });
    const targetPrompt = await harness!.waitForPrompt(sessionId, {
      kind: "choose_target_any",
      afterRaw: announce.raw,
    });

    expect(targetPrompt.prompt.minTargets).toBe(0);
    expect(targetPrompt.prompt.maxTargets).toBe(3);
    expect(targetPrompt.prompt.chosenTargets).toBe(0);

    await harness!.submitAction(sessionId, { kind: "pass" });
    const afterPass = await harness!.waitForPrompt(sessionId, { afterRaw: targetPrompt.raw });
    expect(afterPass.prompt.kind).not.toBe("choose_target_any");
  });
});
