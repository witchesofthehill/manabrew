import { create } from "zustand";
import { getEventBus, getPlatformType } from "@/platform";

/**
 * Stages the app walks through on boot. Mirror of the `stage` values emitted
 * on the `app:init` event channel (see `src/lib/appInit.ts`).
 *
 * The game engine is deliberately absent: the wasm worker and its card archive
 * load lazily behind the first Manabrew-engine game, so neither one can hold
 * the app closed.
 *
 * - `idle`: not started yet
 * - `assets`: set list, preset decks, and token archive in flight
 * - `decks`: warming the deck-cover images
 * - `ready`: boot complete; gate releases the app
 */
export type AppInitStage = "idle" | "assets" | "decks" | "ready";

export interface AppInitState {
  stage: AppInitStage;
}

export const useAppInitStore = create<AppInitState>(() => ({
  stage: getPlatformType() === "web" ? "idle" : "ready",
}));

if (typeof window !== "undefined" && getPlatformType() === "web") {
  getEventBus().on<{ stage: AppInitStage }>("app:init", (payload) => {
    useAppInitStore.setState({ stage: payload.stage });
  });
}
