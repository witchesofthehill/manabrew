/**
 * Full Redux DevTools embedded as a React component.
 * Bridges all zustand stores into a single Redux store for inspection.
 * Toggle with Ctrl+Shift+D. Only rendered in development mode.
 */
import { useEffect } from "react";
import { createStore } from "redux";
import { createDevTools } from "@redux-devtools/core";
import { DockMonitor } from "@redux-devtools/dock-monitor";
import { InspectorMonitor } from "@redux-devtools/inspector-monitor";

import { useGameStore } from "@/stores/useGameStore";
import { useGameUIStore } from "@/stores/useGameUIStore";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { useServerStore } from "@/stores/useServerStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { usePreferredPrintsStore } from "@/stores/usePreferredPrintsStore";
import { useStackUIStore } from "@/stores/useStackUIStore";

type StoreEntry = { getState: () => unknown; subscribe: (fn: () => void) => () => void };

const STORES: Record<string, StoreEntry> = {
  game: useGameStore,
  gameUI: useGameUIStore,
  gameDev: useGameDevStore,
  deck: useDeckStore,
  server: useServerStore,
  auth: useAuthStore,
  preferences: usePreferencesStore,
  preferredPrints: usePreferredPrintsStore,
  stackUI: useStackUIStore,
};

/** Strip functions from a state object for serialisation. */
function stripFunctions(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripFunctions);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v !== "function") out[k] = v;
  }
  return out;
}

/** Collect all zustand state into one object. */
function collectState(): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const [name, store] of Object.entries(STORES)) {
    state[name] = stripFunctions(store.getState());
  }
  return state;
}

type BridgeAction = { type: string; storeName?: string };

function bridgeReducer(
  state: Record<string, unknown> = collectState(),
  action: BridgeAction,
): Record<string, unknown> {
  if (action.type === "@@INIT") return collectState();
  if (action.storeName) {
    // Update only the changed store slice
    const store = STORES[action.storeName];
    if (store) {
      return { ...state, [action.storeName]: stripFunctions(store.getState()) };
    }
  }
  return collectState();
}

const DevTools = createDevTools(
  <DockMonitor
    toggleVisibilityKey="ctrl-shift-d"
    changePositionKey="ctrl-shift-q"
    changeMonitorKey="ctrl-shift-m"
    defaultIsVisible={false}
    defaultPosition="right"
    defaultSize={0.3}
    fluid
  >
    <InspectorMonitor theme="nicinabox" invertTheme={false} />
  </DockMonitor>,
);

let bridgeStore: ReturnType<typeof createStore> | null = null;

function getBridgeStore() {
  if (!bridgeStore) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bridgeStore = createStore(bridgeReducer, DevTools.instrument() as any);
  }
  return bridgeStore;
}

export function DevToolsPanel() {
  // getBridgeStore is a module-level singleton getter — same identity across renders.
  const store = getBridgeStore();

  // Subscribe to all zustand stores and dispatch bridge actions on change
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];
    for (const [name, zustandStore] of Object.entries(STORES)) {
      const unsub = zustandStore.subscribe(() => {
        store.dispatch({ type: `[${name}] state changed`, storeName: name });
      });
      unsubscribers.push(unsub);
    }
    return () => unsubscribers.forEach((fn) => fn());
  }, [store]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <DevTools store={store as any} />;
}
