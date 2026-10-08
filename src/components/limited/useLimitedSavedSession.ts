import { useEffect, useState } from "react";
import { readLimitedSave, subscribeLimitedSaves } from "@/game/limitedStorage";
import type { LimitedSavedSession } from "@/game/limitedPersistence.types";

export function useLimitedSavedSession(sessionId: string | null) {
  const [result, setResult] = useState<{
    sessionId: string | null;
    saved: LimitedSavedSession | null;
    error: string | null;
  }>({ sessionId: null, saved: null, error: null });
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (!sessionId) return;
      void readLimitedSave(sessionId)
        .then((record) => {
          if (!cancelled) setResult({ sessionId, saved: record, error: null });
        })
        .catch((cause) => {
          if (!cancelled) setResult({ sessionId, saved: null, error: String(cause) });
        });
    };
    load();
    const off = subscribeLimitedSaves(load);
    return () => {
      cancelled = true;
      off();
    };
  }, [sessionId]);
  return result.sessionId === sessionId
    ? { saved: result.saved, error: result.error }
    : { saved: null, error: null };
}

export function useLimitedSessionSource(sessionId: string | null): "set" | "mixed" | "cube" {
  const { saved } = useLimitedSavedSession(sessionId);
  const setup = saved?.setup as
    | {
        customPool?: boolean;
        poolType?: string;
        cubeId?: string;
        sourceKind?: string;
        pool?: Array<{ setCode: string }>;
      }
    | undefined;
  if (!saved) return "mixed";
  if (
    setup?.customPool ||
    setup?.cubeId ||
    setup?.poolType === "Custom" ||
    setup?.poolType === "Import" ||
    saved.draftHost?.config.cubeId ||
    saved.connection?.room.sealed_config?.cube_id
  )
    return "cube";
  if (
    setup?.poolType === "Chaos" ||
    setup?.poolType === "FantasyBlock" ||
    setup?.sourceKind === "mixed"
  )
    return "mixed";
  if (setup?.pool && new Set(setup.pool.map((card) => card.setCode.toLowerCase())).size > 1)
    return "mixed";
  return "set";
}
