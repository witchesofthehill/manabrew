import { relayUsername } from "@/lib/relayUsername";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";

export async function resyncRelayIdentity(): Promise<void> {
  const server = useServerStore.getState();
  if (!server.connected || server.connecting) return;
  if (server.currentRoom || server.gameStarted) return;
  if (server.reconnect.phase !== "idle") return;
  const username = relayUsername();
  if (!username) return;
  const sessionAvatar =
    server.players.find((player) => player.username === server.username)?.avatar_url ?? undefined;
  const accountAvatar = useAuthStore.getState().account?.avatarUrl ?? undefined;
  if (username === server.username && sessionAvatar === accountAvatar) return;
  const prefs = usePreferencesStore.getState();
  await server.connect(prefs.serverHost, prefs.serverPort, username, prefs.serverPassword);
}
