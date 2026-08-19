import { describe, expect, it, vi, afterEach } from "vitest";
import type { Application } from "pixi.js";

type Listener = () => void;

/**
 * `visibility` keeps module-level state (installed listeners, current paused
 * flag), so every case re-imports it against a freshly stubbed document.
 */
async function loadVisibility(initial: { hidden: boolean; focused: boolean }) {
  const listeners = new Map<string, Listener[]>();
  const state = { ...initial };

  const addListener = (type: string, fn: Listener) => {
    const existing = listeners.get(type) ?? [];
    existing.push(fn);
    listeners.set(type, existing);
  };

  vi.stubGlobal("document", {
    get hidden() {
      return state.hidden;
    },
    hasFocus: () => state.focused,
    addEventListener: addListener,
  });
  vi.stubGlobal("window", { addEventListener: addListener });

  vi.resetModules();
  const { registerPixiApp } = await import("./visibility");

  return {
    registerPixiApp,
    listenerTypes: () => [...listeners.keys()],
    setHidden(hidden: boolean) {
      state.hidden = hidden;
      for (const fn of listeners.get("visibilitychange") ?? []) fn();
    },
    setFocused(focused: boolean) {
      state.focused = focused;
      for (const fn of listeners.get(focused ? "focus" : "blur") ?? []) fn();
    },
  };
}

function fakeApp() {
  const ticker = { stop: vi.fn(), start: vi.fn() };
  return { app: { ticker } as unknown as Application, ticker };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pixi visibility", () => {
  it("keeps rendering when the window is merely unfocused", async () => {
    const v = await loadVisibility({ hidden: false, focused: true });
    const { app, ticker } = fakeApp();
    v.registerPixiApp(app);

    v.setFocused(false);

    // A window sitting visible on a second monitor must keep drawing, or the
    // board freezes mid-game until it is clicked again (#618).
    expect(ticker.stop).not.toHaveBeenCalled();
  });

  it("does not subscribe to focus changes at all", async () => {
    const v = await loadVisibility({ hidden: false, focused: true });
    v.registerPixiApp(fakeApp().app);

    expect(v.listenerTypes()).toEqual(["visibilitychange"]);
  });

  it("pauses while hidden and resumes when shown", async () => {
    const v = await loadVisibility({ hidden: false, focused: true });
    const { app, ticker } = fakeApp();
    v.registerPixiApp(app);

    v.setHidden(true);
    expect(ticker.stop).toHaveBeenCalledTimes(1);

    v.setHidden(false);
    expect(ticker.start).toHaveBeenCalledTimes(1);
  });

  it("starts an app paused when it registers while hidden", async () => {
    const v = await loadVisibility({ hidden: true, focused: false });
    const { app, ticker } = fakeApp();
    v.registerPixiApp(app);

    expect(ticker.stop).toHaveBeenCalledTimes(1);
  });

  it("stops tracking an app once unregistered", async () => {
    const v = await loadVisibility({ hidden: false, focused: true });
    const { app, ticker } = fakeApp();
    const unregister = v.registerPixiApp(app);

    unregister();
    v.setHidden(true);

    expect(ticker.stop).not.toHaveBeenCalled();
  });
});
