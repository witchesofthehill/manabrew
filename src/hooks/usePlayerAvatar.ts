import { useServerStore } from "@/stores/useServerStore";

export function usePlayerAvatar(username: string | undefined): string | undefined {
  return useServerStore((s) =>
    username === undefined ? undefined : s.players.find((p) => p.username === username)?.avatar_url,
  );
}
