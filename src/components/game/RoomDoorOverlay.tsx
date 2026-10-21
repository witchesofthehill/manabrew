import type { CardDto } from "@/protocol/game";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { ROOM_DOOR_BOUNDS, roomDoorState } from "@/components/game/cardPresentation";

export function RoomDoorOverlay({ card }: { card: CardDto }) {
  const theme = useTheme().gameTheme;
  const state = roomDoorState(card);
  if (state === undefined) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[3] rounded-[inherit]" aria-hidden>
      {ROOM_DOOR_BOUNDS.map(({ door, x, width }, half) => {
        const active = (state & (1 << half)) !== 0;
        return (
          <div
            key={door}
            data-room-door={door}
            data-room-door-state={active ? "active" : "inactive"}
            className="absolute"
            style={{
              left: `${x * 100 + 1}%`,
              top: "1.5%",
              width: `${width * 100 - 2}%`,
              height: "97%",
              borderRadius: "1cqw",
              background: active ? undefined : withAlpha(theme.canvas.shadow, 0.42),
              boxShadow: active
                ? `inset 0 0 0 max(2px, 0.7cqw) ${theme.activeAction.active}, inset 0 0 0 max(3px, 1.2cqw) ${theme.canvas.shadow}`
                : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
