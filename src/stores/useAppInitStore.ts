import { create } from "zustand";
import { getEventBus, getPlatformType } from "@/platform";

/**
 * Stages the worker walks through on first init. Mirror of the `stage` values
 * the worker emits on the `worker:init` event channel (see
 * `src/workers/game-engine.worker.ts::loadCardData`).
 *
 * - `idle`: not started yet
 * - `cached`: archive served from Cache API, no network
 * - `downloading`: cache miss, fetching from origin (loaded / total tracked)
 * - `parsing`: WASM is parsing the 32k card scripts into the database
 * - `ready`: fully initialized; gate releases the app
 * - `error`: init failed; gate shows the error and offers a retry
 */
export type AppInitStage = "idle" | "cached" | "downloading" | "parsing" | "ready" | "error";

export interface AppInitState {
  stage: AppInitStage;
  loaded: number;
  total: number;
  errorMessage?: string;
}

interface AppInitInternal extends AppInitState {
  retry: () => void;
}

export const useAppInitStore = create<AppInitInternal>((set) => ({
  stage: getPlatformType() === "web" ? "idle" : "ready",
  loaded: 0,
  total: 0,
  retry: () => {
    set({ stage: "idle", loaded: 0, total: 0, errorMessage: undefined });
  },
}));

if (typeof window !== "undefined" && getPlatformType() === "web") {
  getEventBus().on<{
    stage: AppInitStage;
    loaded?: number;
    total?: number;
    message?: string;
  }>("worker:init", (payload) => {
    useAppInitStore.setState({
      stage: payload.stage,
      loaded: payload.loaded ?? useAppInitStore.getState().loaded,
      total: payload.total ?? useAppInitStore.getState().total,
      errorMessage: payload.message,
    });
  });
}
