import { useAuthStore } from "@/stores/useAuthStore";
import { useServerStore } from "@/stores/useServerStore";

export function usePlayerAvatar(username: string | undefined): string | undefined {
  const accountAvatarUrl = useAuthStore((s) => s.account?.avatarUrl);
  return useServerStore((s) => {
    if (username === undefined) return undefined;
    return (
      s.players.find((player) => player.username === username)?.avatar_url ??
      (s.username === username ? accountAvatarUrl : undefined)
    );
  });
}
