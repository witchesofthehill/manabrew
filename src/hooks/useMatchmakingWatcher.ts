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

async function joinTable() {
  if (localGameActive()) await useGameStore.getState().endGame();
  await useMatchmakingStore.getState().answerTableCall(true);
}

export function useMatchmakingWatcher(): void {
  const navigate = useNavigate();
  const phase = useMatchmakingStore((s) => s.phase);
  const proposal = useMatchmakingStore((s) => s.proposal);
  const accepted = useMatchmakingStore((s) => s.accepted);
  const match = useMatchmakingStore((s) => s.match);
  const tableCall = useMatchmakingStore((s) => s.tableCall);

  useEffect(() => {
    if (phase !== "matched" || !match) return;
    useMatchmakingStore.getState().clearMatch();
    navigate(ROUTES.LOBBY);
  }, [match, navigate, phase]);

  useEffect(() => {
    if (phase !== "proposed" || !proposal || accepted || !localGameActive()) return;
    const id = toast(`Match found: bracket ${proposal.bracket} ${tableLabel(proposal.pod_size)}`, {
      description: "Join within 30 seconds. Joining ends this game.",
      duration: proposal.expires_s * 1000,
      action: { label: "Join now", onClick: () => void joinFromLocalGame() },
      cancel: {
        label: "Leave queue",
        onClick: () => void useMatchmakingStore.getState().declineMatch(),
      },
    });
    return () => {
      toast.dismiss(id);
    };
  }, [accepted, phase, proposal]);

  useEffect(() => {
    if (!tableCall) return;
    const id = toast(`${tableCall.host} needs players for a ${tableLabel(tableCall.pod_size)}`, {
      description: `Bracket ${tableCall.bracket}, ${tableCall.seats} seat(s) open. First to join get the seats.${
        localGameActive() ? " Joining ends this game." : ""
      }`,
      duration: tableCall.expires_s * 1000,
      action: { label: "Join", onClick: () => void joinTable() },
      cancel: {
        label: "No thanks",
        onClick: () => void useMatchmakingStore.getState().answerTableCall(false),
      },
      onAutoClose: () => useMatchmakingStore.setState({ tableCall: null }),
    });
    return () => {
      toast.dismiss(id);
    };
  }, [tableCall]);
}
