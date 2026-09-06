import { useLocation, useNavigate } from "react-router-dom";
import { RoomInviteCard } from "@/components/lobby/RoomInviteCard";
import { ROUTES } from "@/lib/constants";
import { useInviteStore } from "@/stores/useInviteStore";
import { useServerStore } from "@/stores/useServerStore";

interface RoomInviteOverlayProps {
  /** Rendered inside the lobby's side panel as a flat banner instead of floating. */
  inline?: boolean;
}

export function RoomInviteOverlay({ inline = false }: RoomInviteOverlayProps) {
  const invites = useInviteStore((s) => s.invites);
  const accept = useInviteStore((s) => s.accept);
  const dismiss = useInviteStore((s) => s.dismiss);
  const players = useServerStore((s) => s.players);
  const navigate = useNavigate();
  const inLobby = useLocation().pathname === ROUTES.LOBBY;

  if (invites.length === 0) return null;
  if (!inline && inLobby) return null;

  const cards = invites.map((invite) => (
    <RoomInviteCard
      key={invite.room.room_id}
      from={invite.from}
      fromAvatarUrl={players.find((p) => p.username === invite.from)?.avatar_url}
      room={invite.room}
      onJoin={() => {
        void accept(invite).then((joined) => {
          if (joined && !inLobby) navigate(ROUTES.LOBBY);
        });
      }}
      onIgnore={() => dismiss(invite.room.room_id)}
      className={inline ? "rounded-none border-0 border-b bg-primary/5 shadow-none" : undefined}
    />
  ));

  if (inline) return <div className="shrink-0">{cards}</div>;

  return (
    <div className="pointer-events-none fixed top-[calc(var(--safe-area-inset-top)+4.25rem)] right-[calc(var(--safe-area-inset-right)+1rem)] z-50 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2 sm:right-[calc(var(--safe-area-inset-right)+1.5rem)] lg:right-[calc(var(--safe-area-inset-right)+2rem)]">
      {cards}
    </div>
  );
}
