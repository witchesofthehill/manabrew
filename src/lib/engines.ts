import { isIronsmithRuntimeEnabled } from "@/game/runtimeRegistry";
import { usePresetDecksStore } from "@/stores/usePresetDecksStore";
import type { EngineKind } from "@/protocol";

export function availableEngines(): EngineKind[] {
  return isIronsmithRuntimeEnabled() ? ["Manabrew", "Forge", "Ironsmith"] : ["Manabrew", "Forge"];
}

/** A deck with no engines list runs on any available engine. */
export function supportsAvailableEngine(engines: EngineKind[] | undefined | null): boolean {
  if (!engines || engines.length === 0) return true;
  const available = availableEngines();
  return engines.some((engine) => available.includes(engine));
}

export function supportsEngine(
  engines: EngineKind[] | undefined | null,
  engine: EngineKind,
): boolean {
  return !engines || engines.length === 0 || engines.includes(engine);
}

/** Entry engines, falling back to the local preset catalog for preset-sourced
 *  entries served by a hub that predates the engines column. */
export function hubEntryEngines(entry: {
  engines?: EngineKind[];
  presetKey?: string;
}): EngineKind[] | undefined {
  if (entry.engines) return entry.engines;
  if (!entry.presetKey) return undefined;
  return usePresetDecksStore.getState().decks.find((deck) => deck.id === entry.presetKey)?.engines;
}
