import type { PlayerHudSpec } from "@/pixi/hud/playerHud.types";
import type { GameIconName } from "@/components/game/GameIcon";
import { GameIcon } from "@/components/game/GameIcon";
import { Modal } from "@/components/game/modals/Modal";
import { ManaPool } from "./ManaPool";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

interface PlayerSheetModalProps {
  spec: PlayerHudSpec;
  onClose: () => void;
}

/** Full detail sheet for a player — opened by tapping a non-targetable avatar.
 *  Reuses the HUD's already-resolved badge list (labels, counts, per-source
 *  commander-damage colours) so it can't drift from the capsule. */
export function PlayerSheetModal({ spec, onClose }: PlayerSheetModalProps) {
  const theme = useTheme().gameTheme;
  const hasMana = Object.values(spec.manaPool).some((v) => v > 0);

  return (
    <Modal onClose={onClose} maxWidth="max-w-sm">
      <Modal.Header onClose={onClose}>
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full font-bold text-white"
            style={{ backgroundColor: spec.color }}
          >
            {spec.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{spec.isSelf ? "You" : spec.name}</div>
            <div className="text-sm font-medium" style={{ color: theme.life }}>
              ♥ {spec.life} life
            </div>
          </div>
        </div>
      </Modal.Header>
      <Modal.Body>
        {hasMana && (
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Mana pool</span>
            <ManaPool pool={spec.manaPool} />
          </div>
        )}
        <ul className="space-y-1.5">
          {spec.badges.map((b) => (
            <li key={b.id} className="flex items-center gap-2 text-sm">
              <GameIcon
                name={b.icon as GameIconName}
                className="h-4 w-4"
                style={{ color: b.color }}
              />
              <span className="flex-1">{b.label}</span>
              {b.count !== undefined && (
                <span
                  className="font-bold tabular-nums"
                  style={{ color: b.lethal ? theme.pt.lethal : undefined }}
                >
                  {b.count}
                </span>
              )}
            </li>
          ))}
        </ul>
        {spec.isEliminated && (
          <div className={cn("mt-3 text-sm font-semibold")} style={{ color: theme.pt.lethal }}>
            Eliminated
          </div>
        )}
      </Modal.Body>
    </Modal>
  );
}
