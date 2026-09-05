import { GameIcon } from "@/components/game/GameIcon";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { Modal } from "@/components/game/modals/Modal";
import { RING_ABILITIES } from "@/components/game/game.constants";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { MANA_LETTERS } from "@/themes/gameTheme";
import type { GameIconName } from "@/components/game/GameIcon";
import type { PlayerHudBadge, PlayerHudSpec } from "@/pixi/hud/playerHud.types";

interface PlayerSheetModalProps {
  spec: PlayerHudSpec;
  onClose: () => void;
}

export function PlayerSheetModal({ spec, onClose }: PlayerSheetModalProps) {
  const theme = useTheme().gameTheme;
  const resources: PlayerHudBadge[] = [];
  const states: PlayerHudBadge[] = [];
  const commanderDamage: PlayerHudBadge[] = [];
  for (const badge of spec.badges) {
    if (badge.id.startsWith("cmd-")) commanderDamage.push(badge);
    else if (badge.zone || badge.id === "hand") resources.push(badge);
    else states.push(badge);
  }
  const sections = [
    { title: "Hand and zones", badges: resources, empty: "No zone resources reported." },
    { title: "Player states", badges: states, empty: "No player states reported." },
    {
      title: "Commander damage by source",
      badges: commanderDamage,
      empty: "No commander damage reported.",
    },
  ];

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <Modal.Header onClose={onClose} className="shrink-0">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-text-on-tinted"
            style={{ backgroundColor: spec.color }}
          >
            {spec.avatarUrl ? (
              <img
                src={spec.avatarUrl}
                crossOrigin="anonymous"
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              spec.name.slice(0, 1).toUpperCase()
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-lg font-semibold">{spec.name}</h2>
            {(spec.isSelf || spec.isBot) && (
              <p className="text-xs text-muted-foreground">{spec.isSelf ? "You" : "Bot"}</p>
            )}
          </div>
          <div className="shrink-0 text-right" style={{ color: theme.life }}>
            <div className="text-3xl font-bold leading-none tabular-nums">{spec.life}</div>
            <div className="mt-1 text-xs font-medium">Life</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
          {spec.isActiveTurn && <span className="mt-2 text-active-action-active">Active turn</span>}
          {spec.isPriorityPlayer && (
            <span className="mt-2 text-active-action-priority">Has priority</span>
          )}
          {spec.isDisconnected && <span className="mt-2 text-muted-foreground">Disconnected</span>}
          {spec.isEliminated && <span className="mt-2 text-pt-lethal">Eliminated</span>}
          {spec.inCombat && (
            <span
              className={cn("mt-2", spec.combatLethal ? "text-pt-lethal" : "text-muted-foreground")}
            >
              {spec.combatLethal ? "Lethal combat damage incoming" : "In combat"}
            </span>
          )}
        </div>
      </Modal.Header>
      <section aria-label="Floating mana" className="shrink-0 border-b px-4 py-3">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Floating mana</h3>
        <dl className="grid grid-cols-6 gap-1.5">
          {MANA_LETTERS.map((letter) => {
            const count = spec.manaPool[letter] ?? 0;
            return (
              <div
                key={letter}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-1.5 rounded-md border bg-muted/30 px-1 py-2",
                  count === 0 && "text-muted-foreground",
                )}
              >
                <dt className={cn("flex items-center", count === 0 && "opacity-50")}>
                  <ManaSymbols cost={letter} size="lg" className="mx-0" />
                </dt>
                <dd className="max-w-full break-all text-sm font-semibold tabular-nums">{count}</dd>
              </div>
            );
          })}
        </dl>
      </section>
      <Modal.Body className="min-h-0 space-y-5">
        {sections.map(({ title, badges, empty }) => (
          <section key={title} aria-label={title}>
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{title}</h3>
            {badges.length === 0 ? (
              <p className="text-sm text-muted-foreground">{empty}</p>
            ) : (
              <ul className="space-y-1">
                {badges.map((badge) => {
                  const content = (
                    <>
                      <GameIcon
                        name={badge.icon as GameIconName}
                        className="h-4 w-4 shrink-0"
                        style={{ color: badge.color }}
                      />
                      <span className="min-w-0 flex-1 break-words">{badge.label}</span>
                      {badge.lethal && (
                        <span className="shrink-0 text-xs font-semibold text-pt-lethal">
                          Lethal
                        </span>
                      )}
                      {badge.count !== undefined && (
                        <span
                          className={cn(
                            "shrink-0 font-bold tabular-nums",
                            badge.lethal && "text-pt-lethal",
                          )}
                        >
                          {badge.count}
                        </span>
                      )}
                      {badge.onTap && (
                        <span className="shrink-0 text-xs text-muted-foreground">View</span>
                      )}
                    </>
                  );
                  const rowClassName = cn(
                    "flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                    badge.lethal && "bg-pt-lethal/10",
                  );
                  return (
                    <li key={badge.id}>
                      {badge.onTap ? (
                        <button
                          type="button"
                          className={cn(
                            rowClassName,
                            "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          )}
                          onClick={() => {
                            onClose();
                            badge.onTap?.();
                          }}
                          onKeyUp={(event) => {
                            if (event.code === "Space") event.currentTarget.click();
                          }}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className={rowClassName}>{content}</div>
                      )}
                      {badge.id === "ring" && (
                        <ol className="mb-2 ml-8 list-decimal space-y-2 pl-4 text-xs">
                          {RING_ABILITIES.map((ability, index) => {
                            const active = index < (badge.count ?? 0);
                            return (
                              <li key={ability} className={cn(!active && "text-muted-foreground")}>
                                <span className="font-semibold">
                                  {active ? "Active: " : "Not gained: "}
                                </span>
                                {ability}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </Modal.Body>
    </Modal>
  );
}
