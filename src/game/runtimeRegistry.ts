import { getPlatform } from "@/platform";
import { ManualTabletopGameApi } from "./manualTabletopApi";
import type { GameRuntime, GameRuntimeCapabilities, GameRuntimeKind } from "./runtime.types";

const manualTabletopApi = new ManualTabletopGameApi();
let selectedRuntimeKind: GameRuntimeKind = "rust-engine";

function getPlatformGameCapabilities(): GameRuntimeCapabilities {
  const platform = getPlatform();
  return {
    multiplayer: platform.isSupported("multiplayer"),
    snapshots: true,
    deckAvailabilityCheck: true,
    manualTabletop: false,
    concedeBehavior: "send-action",
  };
}

const rustRuntime: GameRuntime = {
  kind: "rust-engine",
  label: "Rust engine",
  get capabilities() {
    return getPlatformGameCapabilities();
  },
  get api() {
    return getPlatform().game;
  },
};

const manualTabletopRuntime: GameRuntime = {
  kind: "manual-tabletop",
  label: "Manual tabletop",
  capabilities: {
    multiplayer: false,
    snapshots: false,
    deckAvailabilityCheck: false,
    manualTabletop: true,
    concedeBehavior: "end-session",
  },
  api: manualTabletopApi,
};

const runtimes: Record<GameRuntimeKind, GameRuntime | null> = {
  "rust-engine": rustRuntime,
  "manual-tabletop": manualTabletopRuntime,
  "forge-java": null,
};

export function getAvailableGameRuntimes(): GameRuntime[] {
  return Object.values(runtimes).filter((runtime): runtime is GameRuntime => runtime !== null);
}

export function getSelectedGameRuntime(): GameRuntime {
  return runtimes[selectedRuntimeKind] ?? rustRuntime;
}

export function getSelectedGameRuntimeKind(): GameRuntimeKind {
  return selectedRuntimeKind;
}

export function selectGameRuntime(kind: GameRuntimeKind): GameRuntime {
  const runtime = runtimes[kind];
  if (!runtime) {
    throw new Error(`Game runtime is not available: ${kind}`);
  }
  selectedRuntimeKind = kind;
  return runtime;
}

export function resetSelectedGameRuntime(): GameRuntime {
  return selectGameRuntime("rust-engine");
}

export function getDefaultGameRuntime(): GameRuntime {
  return rustRuntime;
}
