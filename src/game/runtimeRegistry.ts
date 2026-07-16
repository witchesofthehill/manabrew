import { getPlatform } from "@/platform";
import { isFeatureEnabled } from "@/featureFlags";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
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

// Ironsmith is experimental and opt-in: it needs the compile flag, a bundled
// wasm, AND the user's Settings toggle. Resolved dynamically (not baked into the
// map) so flipping the Settings toggle takes effect without a reload.
export function isIronsmithRuntimeEnabled(): boolean {
  return (
    isFeatureEnabled("ironsmithRuntime") &&
    IRONSMITH_WASM_AVAILABLE &&
    usePreferencesStore.getState().ironsmithRuntimeEnabled
  );
}

const runtimes: Record<GameRuntimeKind, GameRuntime | null> = {
  manabrew: manabrewRuntime,
  ironsmith: ironsmithRuntime,
  "manual-tabletop": manualTabletopRuntime,
  forge: null,
};

function resolveRuntime(kind: GameRuntimeKind): GameRuntime | null {
  if (kind === "ironsmith" && !isIronsmithRuntimeEnabled()) return null;
  return runtimes[kind];
}

export function getAvailableGameRuntimes(): GameRuntime[] {
  return (Object.keys(runtimes) as GameRuntimeKind[])
    .map(resolveRuntime)
    .filter((runtime): runtime is GameRuntime => runtime !== null);
}

export function getSelectedGameRuntime(): GameRuntime {
  return resolveRuntime(selectedRuntimeKind) ?? manabrewRuntime;
}

export function getSelectedGameRuntimeKind(): GameRuntimeKind {
  return selectedRuntimeKind;
}

export function selectGameRuntime(kind: GameRuntimeKind): GameRuntime {
  const runtime = resolveRuntime(kind);
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
