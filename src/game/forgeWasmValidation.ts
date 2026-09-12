import { getSelectedGameRuntime } from "@/game/runtimeRegistry";
import { presetSupportsEngine } from "@/lib/presetDecks";
import { recordForgeWasmVerdict } from "@/lib/forgeWasm";
import { usePresetDecksStore } from "@/stores/usePresetDecksStore";
import { DEFAULT_STARTING_LIFE } from "@/stores/useServerStore";

const START_TIMEOUT_MS = 3 * 60_000;

export async function validateForgeWasm(): Promise<boolean> {
  await usePresetDecksStore.getState().prefetch();
  const [deck, opponent] = usePresetDecksStore
    .getState()
    .decks.filter((preset) => presetSupportsEngine(preset, "Forge"));
  if (!deck || !opponent) {
    recordForgeWasmVerdict(false, "no Forge preset decks to start a trial game with");
    return false;
  }
  const runtime = getSelectedGameRuntime();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runtime.api.startGame({
        deck,
        startingLife: DEFAULT_STARTING_LIFE,
        commanderName: null,
        opponentDecks: [opponent],
        engine: "Forge",
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("engine did not start in time")),
          START_TIMEOUT_MS,
        );
      }),
    ]);
    recordForgeWasmVerdict(true);
    return true;
  } catch (error) {
    recordForgeWasmVerdict(false, error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    clearTimeout(timer);
    await runtime.api.endGame().catch(() => {});
  }
}
