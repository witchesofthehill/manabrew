import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launchOpts } from "../e2e-ironsmith/lib.mjs";

const BASE = process.env.BASE || "http://localhost:1420";
const browser = await chromium.launch(launchOpts());

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(BASE);
  await page.waitForFunction(() => Boolean(window.__gameStore));
  await page.evaluate(async () => {
    const { createPlaygroundTable, LOCAL_PLAYER_ID } =
      await import("/src/components/dev/boardPlayground.data.ts");
    const { playgroundGameView } = await import("/src/components/dev/boardGameplayPreview.data.ts");
    const table = createPlaygroundTable("sparse");
    const gameView = playgroundGameView(table, []);
    const attacker = gameView.battlefield.find(
      (card) => card.controllerId !== LOCAL_PLAYER_ID && card.types.includes("Creature"),
    );
    const blockers = gameView.battlefield.filter(
      (card) => card.controllerId === LOCAL_PLAYER_ID && card.types.includes("Creature"),
    );
    window.__keyboardResponses = [];
    window.__gameStore.setState({
      gameView: { ...gameView, step: "combatDeclareBlockers" },
      isGameActive: true,
      isPrefetchingCards: false,
      isRenderingCards: false,
      myPlayerSlot: LOCAL_PLAYER_ID,
      currentPrompt: {
        promptId: 1,
        input: {
          type: "chooseBlockers",
          attackers: [
            {
              attackerId: attacker.id,
              validBlockerIds: blockers.map((card) => card.id),
              minBlockers: 1,
              mustBeBlocked: false,
            },
          ],
          availableBlockerIds: blockers.map((card) => card.id),
        },
      },
      respond: async (output) => {
        window.__keyboardResponses.push(output);
        window.__gameStore.setState({ isWaitingForResponse: true });
      },
    });
    history.pushState(null, "", "/game/no-blocks-keyboard");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForSelector("canvas");
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Space");
  assert.deepEqual(
    await page.evaluate(() => window.__keyboardResponses),
    [{ type: "declareBlockers", assignments: [] }],
    "Space must submit an empty blocker declaration through the mounted game keyboard handler",
  );

  await page.keyboard.press("Space");
  assert.equal(
    await page.evaluate(() => window.__keyboardResponses.length),
    1,
    "Space must not submit another declaration while a response is pending",
  );

  await page.evaluate(() => {
    window.__gameStore.setState({ isWaitingForResponse: false });
    const input = document.createElement("input");
    input.id = "keyboard-focus-check";
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press("Space");
  assert.equal(await page.locator("#keyboard-focus-check").inputValue(), " ");
  assert.equal(await page.evaluate(() => window.__keyboardResponses.length), 1);
  await page.evaluate(async () => {
    document.querySelector("#keyboard-focus-check").remove();
    const { useKeybindingsStore } = await import("/src/stores/useKeybindingsStore.ts");
    useKeybindingsStore.getState().setBinding("pass-priority", { key: "enter" });
  });
  await page.keyboard.press("Space");
  assert.equal(
    await page.evaluate(() => window.__keyboardResponses.length),
    1,
    "The old shortcut must stop submitting after remapping",
  );
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => window.__keyboardResponses), [
    { type: "declareBlockers", assignments: [] },
    { type: "declareBlockers", assignments: [] },
  ]);
  console.log("PASS: no-blocks shortcut, pending-response guard, editable focus, and remapping");
} finally {
  await browser.close();
}
