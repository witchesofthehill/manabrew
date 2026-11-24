import {
  captureClientEvent,
  isClientAnalyticsEnabled,
  renewClientVisitId,
  trackClientEvent,
} from "@/lib/clientAnalytics";
import { analyticsAcquisition, analyticsPageUrl } from "@/lib/clientAnalyticsPrivacy";
import type { ClientAnalyticsAttributes } from "@/lib/clientAnalyticsPrivacy";
import { relayUsername } from "@/lib/relayUsername";
import { getClientPlatform } from "@/platform/clientPlatform";
import type { GameState } from "@/stores/gameStore.types";

export type ClientMatchSource = NonNullable<
  ClientAnalyticsAttributes<"first_game_funnel">["source"]
>;
export type ClientUiAction = ClientAnalyticsAttributes<"ui_action">["action"];

const CHECKPOINT_DELAY_MS = 15_000;
const COMPLETED_KEY = "manabrew.analytics.firstMatch";
const MAX_COMPLETED = 20;
const MAX_CLICKS = 999999999;
const SOURCE_NOTE_TTL_MS = 10 * 60_000;
const ACQUISITION = analyticsAcquisition(
  window.location.href,
  document.referrer,
  getClientPlatform(),
);
let sourceNote: { source: ClientMatchSource; at: number } | undefined;
let invitedRoomId: string | undefined;
const handles = new Map<string, { clicks: number; completed: boolean }>();
let handle: string | undefined;
let pending: (() => void) | undefined;
let timer: number | undefined;
let inGame = false;
let stopListening: (() => void) | undefined;

function completedHandles(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(COMPLETED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function rememberCompleted(completed: string) {
  try {
    const next = [completed, ...completedHandles().filter((entry) => entry !== completed)];
    localStorage.setItem(COMPLETED_KEY, JSON.stringify(next.slice(0, MAX_COMPLETED)));
  } catch {
    return;
  }
}

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
    visit = { clicks: 0, completed: completedHandles().includes(nextHandle) };
    handles.set(nextHandle, visit);
    if (visit.completed) return visit;
    trackClientEvent("first_game_funnel", {
      stage: "observed",
      acquisition: ACQUISITION,
      clicks: "0",
    });
  }
  return visit;
}

export function noteClientMatchSource(source: ClientMatchSource) {
  sourceNote = { source, at: performance.now() };
}

export function noteClientInviteAccepted(roomId: string) {
  invitedRoomId = roomId;
}

export function clientMultiplayerSource(
  room: { room_id: string; host: string; draft_config?: unknown; sealed_config?: unknown } | null,
  username: string | null,
): ClientMatchSource {
  if (room?.draft_config || room?.sealed_config) return "limited";
  if (room && room.room_id === invitedRoomId) return "invite";
  return room?.host === username ? "lobby_host" : "lobby_join";
}

export function trackClientUiAction(action: ClientUiAction) {
  const visit = observeClientAnalyticsIdentity();
  if (!visit || visit.completed) return;
  trackClientEvent("ui_action", { action, clicks: String(visit.clicks) });
}

export function trackClientMatchRequested(fallback: ClientMatchSource) {
  const note = sourceNote;
  sourceNote = undefined;
  const source = note && performance.now() - note.at < SOURCE_NOTE_TTL_MS ? note.source : fallback;
  const visit = observeClientAnalyticsIdentity();
  if (!visit || visit.completed) return;
  flushClientAnalyticsFunnel();
  trackClientEvent("first_game_funnel", {
    stage: "match_requested",
    source,
    acquisition: ACQUISITION,
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
    acquisition: ACQUISITION,
    clicks: String(visit.clicks),
  });
  visit.completed = true;
  rememberCompleted(relayUsername());
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
      acquisition: ACQUISITION,
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
  renewClientVisitId();
  import.meta.hot.dispose(() => {
    stopListening?.();
    flushClientAnalyticsFunnel();
  });
}
