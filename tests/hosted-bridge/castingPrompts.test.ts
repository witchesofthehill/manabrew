import { afterEach, describe, expect, it } from "vitest";

import { card, findAction, HostedHarness, type HostedPrompt, type PromptResult } from "./hostedClient";

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
});
