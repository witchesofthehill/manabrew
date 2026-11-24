import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/lib/constants";
import { useMatchmakingStore } from "@/stores/useMatchmakingStore";

export function useMatchmakingWatcher(): void {
  const navigate = useNavigate();
  const phase = useMatchmakingStore((s) => s.phase);
  const match = useMatchmakingStore((s) => s.match);
  const tableCall = useMatchmakingStore((s) => s.tableCall);
  const tableCallExpiresAt = useMatchmakingStore((s) => s.tableCallExpiresAt);

  useEffect(() => {
    if (phase !== "matched" || !match) return;
    useMatchmakingStore.getState().clearMatch();
    navigate(ROUTES.LOBBY, { replace: true });
  }, [match, navigate, phase]);

  useEffect(() => {
    if (!tableCall || !tableCallExpiresAt || phase === "joining") return;
    const id = setTimeout(
      () => {
        if (useMatchmakingStore.getState().tableCall === tableCall) {
          useMatchmakingStore.setState({ tableCall: null, tableCallExpiresAt: null });
        }
      },
      Math.max(0, tableCallExpiresAt - Date.now()),
    );
    return () => clearTimeout(id);
  }, [phase, tableCall, tableCallExpiresAt]);
}
