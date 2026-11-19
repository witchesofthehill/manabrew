import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launchOpts } from "./lib.mjs";

const base = process.env.BASE || "http://localhost:1420";
const browser = await chromium.launch(launchOpts());
try {
  const page = await browser.newPage();
  await page.route("**/__turn-transitions", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body><div id='root'></div></body></html>",
    }),
  );
  await page.goto(`${base}/__turn-transitions`);
  const result = await page.evaluate(async () => {
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { useFlashQueue } = await import("/src/hooks/useFlashQueue.ts");
    const { useGameStore: store } = await import("/src/stores/useGameStore.ts");
    const { applyState } = await import("/src/stores/gameStore.constants.ts");
    const flashes = [];
    const committed = [];
    const waitFor = async (predicate) => {
      const deadline = performance.now() + 15000;
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error("Turn queue did not settle");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    const root = ReactDOM.createRoot(document.getElementById("root"));
    let mounted = false;
    function Probe() {
      const { activeFlash } = useFlashQueue(10);
      React.useEffect(() => {
        mounted = true;
      }, []);
      React.useEffect(() => {
        if (activeFlash?.kind === "turn") flashes.push(activeFlash.turn);
      }, [activeFlash]);
      return null;
    }
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.gameView !== previous.gameView && state.gameView) {
        committed.push([state.gameView.turn, state.gameView.step]);
      }
    });
    const push = (turn, step) =>
      applyState(
        { gameId: "turn-burst", turn, step, activePlayerId: `player-${(turn - 1) % 2}` },
        "stress",
        store.setState,
        store.getState,
      );
    try {
      root.render(React.createElement(Probe));
      await waitFor(() => mounted);
      push(1, "endOfTurn");
      for (const turn of [2, 3]) {
        push(turn, "upkeep");
        await waitFor(() => flashes.includes(turn));
        for (let repeat = 0; repeat < 100; repeat++) push(turn, "upkeep");
        for (const step of ["draw", "main1", "combatBegin", "main2", "endOfTurn", "cleanup"])
          push(turn, step);
        await waitFor(() => !store.getState().isFlashing && !store.getState().deferredQueue.length);
      }
      return { flashes, committed };
    } finally {
      root.unmount();
      unsubscribe();
    }
  });
  assert.deepEqual(result.flashes, [2, 3], "Each turn must flash exactly once");
  for (const turn of [2, 3]) {
    assert.deepEqual(
      [...new Set(result.committed.filter(([value]) => value === turn).map(([, step]) => step))],
      ["upkeep", "draw", "main1", "combatBegin", "main2", "endOfTurn", "cleanup"],
      "Queued phases must commit in order",
    );
  }
  console.log(
    `PASS: ${result.committed.length} snapshots, exactly two turn flashes, ordered phases`,
  );
} finally {
  await browser.close();
}
