import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ROUTES } from "@/lib/constants";
import { localGameActive } from "@/lib/localGamePresence";
import { useGameStore } from "@/stores/useGameStore";
import { tableLabel, useMatchmakingStore } from "@/stores/useMatchmakingStore";

async function joinFromLocalGame() {
  await useGameStore.getState().endGame();
  await useMatchmakingStore.getState().acceptMatch();
}

export function useMatchmakingWatcher(): void {
  const navigate = useNavigate();
  const phase = useMatchmakingStore((s) => s.phase);
  const proposal = useMatchmakingStore((s) => s.proposal);
  const match = useMatchmakingStore((s) => s.match);

  useEffect(() => {
    if (phase !== "matched" || !match) return;
    useMatchmakingStore.getState().clearMatch();
    navigate(ROUTES.LOBBY);
  }, [match, navigate, phase]);

  useEffect(() => {
    if (phase !== "proposed" || !proposal || !localGameActive()) return;
    const id = toast(`Match found: bracket ${proposal.bracket} ${tableLabel(proposal.pod_size)}`, {
      description: "Joining ends your current game.",
      duration: proposal.expires_s * 1000,
      action: { label: "Join", onClick: () => void joinFromLocalGame() },
      cancel: {
        label: "Leave queue",
        onClick: () => void useMatchmakingStore.getState().declineMatch(),
      },
    });
    return () => {
      toast.dismiss(id);
    };
  }, [phase, proposal]);
}
