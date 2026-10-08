import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import { useMultiplayerLimitedStore } from "@/stores/useMultiplayerLimitedStore";
import { limitedSessionRoute, resumeLimitedSession } from "@/game/limitedRecovery";

export function useLimitedSessionRecovery() {
  const navigate = useNavigate();
  const attempted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const draft = useMultiplayerDraftStore.getState();
    const limited = useMultiplayerLimitedStore.getState();
    const sessionId =
      limited.phase !== "idle" ? limited.sessionId : draft.mode !== "idle" ? draft.sessionId : null;
    if (!sessionId) return;
    void resumeLimitedSession(sessionId)
      .then((saved) => {
        if (limited.matchReturn && useMultiplayerLimitedStore.getState().phase === "building")
          navigate(limitedSessionRoute(saved), { replace: true });
      })
      .catch((cause) => {
        const message = String(cause);
        setError(message);
        toast.error(message);
        if (limited.sessionId === sessionId)
          useMultiplayerLimitedStore.getState().setError(message);
        else useMultiplayerDraftStore.getState().setError(message);
      });
  }, [navigate]);
  return { error };
}
