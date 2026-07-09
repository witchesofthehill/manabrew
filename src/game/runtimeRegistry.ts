import { getPlatform } from "@/platform";
import { isFeatureEnabled } from "@/featureFlags";
import { IRONSMITH_WASM_AVAILABLE } from "./ironsmithWasmAvailable";
import { IronsmithTrustedGameApi } from "./ironsmithRuntime";
import { ManualTabletopGameApi } from "./manualTabletopApi";
import type { GameRuntime, GameRuntimeCapabilities, GameRuntimeKind } from "./runtime.types";

const manualTabletopApi = new ManualTabletopGameApi();
const ironsmithApi = new IronsmithTrustedGameApi();
let selectedRuntimeKind: GameRuntimeKind = "manabrew";

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

const manabrewRuntime: GameRuntime = {
  kind: "manabrew",
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

const ironsmithRuntime: GameRuntime = {
  kind: "ironsmith",
  label: "Ironsmith trusted",
  capabilities: {
    multiplayer: true,
    snapshots: false,
    deckAvailabilityCheck: false,
    manualTabletop: false,
    concedeBehavior: "send-action",
  },
  api: ironsmithApi,
};

const runtimes: Record<GameRuntimeKind, GameRuntime | null> = {
  manabrew: manabrewRuntime,
  ironsmith:
    isFeatureEnabled("ironsmithRuntime") && IRONSMITH_WASM_AVAILABLE ? ironsmithRuntime : null,
  "manual-tabletop": manualTabletopRuntime,
  forge: null,
};

export function getAvailableGameRuntimes(): GameRuntime[] {
  return Object.values(runtimes).filter((runtime): runtime is GameRuntime => runtime !== null);
}

export function getSelectedGameRuntime(): GameRuntime {
  return runtimes[selectedRuntimeKind] ?? manabrewRuntime;
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
  return selectGameRuntime("manabrew");
}

export function getDefaultGameRuntime(): GameRuntime {
  return manabrewRuntime;
}
