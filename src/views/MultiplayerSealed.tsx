import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTopBarOverride } from "@/components/layout/TopBarOverride";
import MultiplayerLimitedBuild from "@/views/MultiplayerLimitedBuild";
import { requestLimitedResync } from "@/game/limitedSession";
import { useMultiplayerLimitedStore } from "@/stores/useMultiplayerLimitedStore";
import { useServerStore } from "@/stores/useServerStore";
import { ROUTES } from "@/lib/constants";

export default function MultiplayerSealed() {
  const navigate = useNavigate();
  const phase = useMultiplayerLimitedStore((s) => s.phase);
  useEffect(() => {
    if (phase === "idle") void requestLimitedResync();
  }, [phase]);
  const leave = async (destination: string) => {
    const server = useServerStore.getState();
    if (server.currentRoom?.host === server.username) await server.endGame();
    await server.leaveRoom();
    navigate(destination);
  };
  useTopBarOverride({
    title: "Sealed",
    onBack: () => void leave(ROUTES.LOBBY),
    onHome: () => void leave(ROUTES.PLAY),
    navigationDisabled: true,
  });
  if (phase === "idle")
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground"
      >
        Waiting for the host to deliver your Sealed packs.
      </div>
    );
  return <MultiplayerLimitedBuild />;
}
