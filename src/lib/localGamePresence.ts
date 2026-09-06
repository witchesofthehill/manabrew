/**
 * Telling the relay this player is in a game it cannot see. A game against the
 * AI runs entirely on their machine, so the lobby shows them as available and
 * the in-game gauges miss them.
 *
 * Best-effort in the strongest sense: nothing here is awaited by a caller,
 * nothing here throws, and a game must start and finish exactly the same way
 * with no network at all.
 */
import { getPlatform } from "@/platform";
import { probeTabSession } from "@/lib/tabSession";
import { relayUsername } from "@/lib/relayUsername";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";
import { RELAY_FEATURE, type LocalGameKind } from "@/types/server";

let announced: LocalGameKind | null = null;

export function announceLocalGame(kind: LocalGameKind): void {
  announced = kind;
  void push();
}

export function clearLocalGame(): void {
  if (announced === null) return;
  announced = null;
  void push();
}

/** The relay holds this on the session, so a reconnect starts out idle. */
export function resendLocalGame(): void {
  if (announced !== null) void push();
}

/**
 * Only when nothing else holds the session: `useServerStore.connect` claims the
 * tab session, which disconnects whichever tab holds it, and announcing in the
 * background must never take the lobby away from a tab the player left open.
 */
async function connectForPresence(): Promise<void> {
  const username = relayUsername();
  if (!username) return;
  if ((await probeTabSession(username)) === "held") return;
  const prefs = usePreferencesStore.getState();
  await useServerStore
    .getState()
    .connect(prefs.serverHost, prefs.serverPort, username, prefs.serverPassword);
}

async function push(): Promise<void> {
  try {
    const server = getPlatform().server;
    if (!server) return;
    if (!useServerStore.getState().connected) {
      // Nothing to retract from a relay that never heard from us.
      if (announced === null) return;
      await connectForPresence();
      if (!useServerStore.getState().connected) return;
    }
    if (!useServerStore.getState().hasRelayFeature(RELAY_FEATURE.LocalGame)) return;
    await server.setLocalGame(announced);
  } catch {
    // Presence is never worth failing, delaying or interrupting a game for.
  }
}
