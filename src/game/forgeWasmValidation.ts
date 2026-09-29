import { getSelectedGameRuntime } from "@/game/runtimeRegistry";
import { presetSupportsEngine } from "@/lib/presetDecks";
import { beginForgeWasmTrial, recordForgeWasmVerdict } from "@/lib/forgeWasm";
import { getPlatform } from "@/platform";
import { usePresetDecksStore } from "@/stores/usePresetDecksStore";
import { DEFAULT_STARTING_LIFE } from "@/stores/useServerStore";

export const FORGE_START_TIMEOUT_MS = 3 * 60_000;
export const FORGE_START_TIMEOUT_MESSAGE = "engine did not start in time";

export function withForgeStartTimeout<T>(start: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    start,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(FORGE_START_TIMEOUT_MESSAGE)),
        FORGE_START_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function firstGameSignal(): { signal: Promise<void>; stop: () => void } {
  const events = getPlatform().events;
  let stop = () => {};
  const signal = new Promise<void>((resolve, reject) => {
    const fail = (payload?: { message?: string }) =>
      reject(new Error(payload?.message ?? "engine ended the game before it started"));
    const offs = [
      events.on("game:state", () => resolve()),
      events.on("game:prompt", () => resolve()),
      events.on<{ message?: string }>("game:forced_end", fail),
      events.on<{ message?: string }>("game:fatal", fail),
    ];
    stop = () => offs.forEach((off) => off());
  });
  return { signal, stop };
}

export async function validateForgeWasm(): Promise<boolean> {
  await usePresetDecksStore.getState().prefetch();
  const [deck, opponent] = usePresetDecksStore
    .getState()
    .decks.filter((preset) => presetSupportsEngine(preset, "Forge"));
  if (!deck || !opponent) {
    recordForgeWasmVerdict(false, "engine", "no Forge preset decks to start a trial game with");
    return false;
  }
  const runtime = getSelectedGameRuntime();
  const { signal, stop } = firstGameSignal();
  beginForgeWasmTrial();
  try {
    await withForgeStartTimeout(
      runtime.api
        .startGame({
          deck,
          startingLife: DEFAULT_STARTING_LIFE,
          commanderName: null,
          opponentDecks: [opponent],
          engine: "Forge",
        })
        .then(() => signal),
    );
    recordForgeWasmVerdict(true);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordForgeWasmVerdict(
      false,
      message === FORGE_START_TIMEOUT_MESSAGE ? "timeout" : "engine",
      message,
    );
    return false;
  } finally {
    stop();
    await runtime.api.endGame().catch(() => {});
  }
}
