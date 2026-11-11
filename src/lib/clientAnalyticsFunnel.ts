import {
  captureClientEvent,
  isClientAnalyticsEnabled,
  trackClientEvent,
} from "@/lib/clientAnalytics";
import { analyticsPageUrl } from "@/lib/clientAnalyticsPrivacy";
import { relayUsername } from "@/lib/relayUsername";
import type { GameState } from "@/stores/gameStore.types";

const CHECKPOINT_DELAY_MS = 3000;
const MAX_CLICKS = 999999999;
const VISIT_ID = crypto.randomUUID();
const handles = new Map<string, { clicks: number; completed: boolean }>();
let handle: string | undefined;
let pending: (() => void) | undefined;
let timer: number | undefined;
let inGame = false;
let stopListening: (() => void) | undefined;

function allowed() {
  return (
    isClientAnalyticsEnabled() &&
    analyticsPageUrl(window.location.pathname, window.location.href) !== undefined
  );
}

export function flushClientAnalyticsFunnel() {
  clearTimeout(timer);
  timer = undefined;
  const send = pending;
  pending = undefined;
  send?.();
}

export function observeClientAnalyticsIdentity() {
  if (!allowed()) return;
  const nextHandle = relayUsername();
  if (nextHandle !== handle) {
    flushClientAnalyticsFunnel();
    handle = nextHandle;
  }
  let visit = handles.get(nextHandle);
  if (!visit) {
    visit = { clicks: 0, completed: false };
    handles.set(nextHandle, visit);
    trackClientEvent("first_game_funnel", {
      stage: "observed",
      visit_id: VISIT_ID,
      clicks: "0",
    });
  }
  return visit;
}

export function trackClientMatchRequested() {
  const visit = observeClientAnalyticsIdentity();
  if (!visit || visit.completed) return;
  flushClientAnalyticsFunnel();
  trackClientEvent("first_game_funnel", {
    stage: "match_requested",
    visit_id: VISIT_ID,
    clicks: String(visit.clicks),
  });
}

export function observeClientAnalyticsGame(state: GameState) {
  inGame = state.isGameActive && !state.isPrefetchingCards && state.gameView !== null;
  if (
    !allowed() ||
    state.gamePurpose !== "match" ||
    !state.gameLaunchReady ||
    !state.isGameActive ||
    state.fatalError ||
    state.engineCrash ||
    state.isPrefetchingCards ||
    state.gameLaunchHandle !== relayUsername() ||
    !state.gameView?.gameId ||
    state.gameView.gameOver ||
    state.currentPrompt?.input.type === "gameOver" ||
    state.gameView.players.length < 2 ||
    !state.gameView.players.some(
      (player) => player.id === state.myPlayerSlot && player.isHuman && player.status === "playing",
    )
  )
    return;
  const visit = observeClientAnalyticsIdentity();
  if (!visit || visit.completed) return;
  flushClientAnalyticsFunnel();
  trackClientEvent("first_game_funnel", {
    stage: "game_started",
    visit_id: VISIT_ID,
    clicks: String(visit.clicks),
  });
  visit.completed = true;
}

export function listenClientAnalyticsFunnel() {
  if (!allowed()) return;
  stopListening?.();
  observeClientAnalyticsIdentity();
  let primaryPress = false;
  const pointerDown = (event: PointerEvent) => {
    primaryPress = event.isTrusted && event.isPrimary && event.button === 0;
  };
  const cancelPress = () => {
    primaryPress = false;
  };
  const click = (event: MouseEvent) => {
    if (!event.isTrusted || event.button !== 0 || event.detail === 0 || !primaryPress) return;
    primaryPress = false;
    if (inGame) return;
    const visit = observeClientAnalyticsIdentity();
    if (!visit || visit.completed) return;
    visit.clicks = Math.min(MAX_CLICKS, visit.clicks + 1);
    pending = captureClientEvent("first_game_funnel", {
      stage: "observed",
      visit_id: VISIT_ID,
      clicks: String(visit.clicks),
    });
    timer ??= window.setTimeout(flushClientAnalyticsFunnel, CHECKPOINT_DELAY_MS);
  };
  const hidden = () => {
    if (document.hidden) flushClientAnalyticsFunnel();
  };
  window.addEventListener("pointerdown", pointerDown, true);
  window.addEventListener("pointercancel", cancelPress, true);
  window.addEventListener("scroll", cancelPress, true);
  window.addEventListener("click", click, true);
  window.addEventListener("pagehide", flushClientAnalyticsFunnel, true);
  document.addEventListener("visibilitychange", hidden, true);
  const stop = () => {
    window.removeEventListener("pointerdown", pointerDown, true);
    window.removeEventListener("pointercancel", cancelPress, true);
    window.removeEventListener("scroll", cancelPress, true);
    window.removeEventListener("click", click, true);
    window.removeEventListener("pagehide", flushClientAnalyticsFunnel, true);
    document.removeEventListener("visibilitychange", hidden, true);
    flushClientAnalyticsFunnel();
    if (stopListening === stop) stopListening = undefined;
  };
  stopListening = stop;
  return stop;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopListening?.();
    flushClientAnalyticsFunnel();
  });
}
