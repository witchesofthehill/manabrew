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
    onHome: () => void leave(ROUTES.PLAY),
    navigationDisabled: true,
  });
  if (phase === "idle")
    return (
      <div
        role="status"
        className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-y-auto overscroll-contain px-4 py-3 text-center text-ui-body break-words text-muted-foreground sm:px-6 lg:px-8"
      >
        Waiting for the host to deliver your Sealed packs.
      </div>
    );
  return <MultiplayerLimitedBuild />;
}
