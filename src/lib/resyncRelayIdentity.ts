import { clearIdentityToken } from "@/lib/relayIdentity";
import { relayUsername } from "@/lib/relayUsername";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";

export async function resyncRelayIdentity(): Promise<void> {
  const server = useServerStore.getState();
  if (!server.connected || server.connecting) return;
  if (server.currentRoom || server.gameStarted) return;
  if (server.reconnect.phase !== "idle") return;
  const username = relayUsername();
  if (!username || username === server.username) return;
  clearIdentityToken();
  const prefs = usePreferencesStore.getState();
  await server.connect(prefs.serverHost, prefs.serverPort, username, prefs.serverPassword);
}
