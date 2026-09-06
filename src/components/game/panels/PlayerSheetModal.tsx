import { GameIcon } from "@/components/game/GameIcon";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { Modal } from "@/components/game/modals/Modal";
import { CARD_BACK_IMAGE_URL, RING_ABILITIES } from "@/components/game/game.constants";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { MANA_LETTERS } from "@/themes/gameTheme";
import type { GameIconName } from "@/components/game/GameIcon";
import { PlayerRuleFacts } from "@/components/game/panels/PlayerRuleFacts";
import type { PlayerHudBadge, PlayerHudSpec } from "@/pixi/hud/playerHud.types";
import { ScryfallImg } from "@/components/ScryfallImg";

interface PlayerSheetModalProps {
  spec: PlayerHudSpec;
  onClose: () => void;
}

export function PlayerSheetModal({ spec, onClose }: PlayerSheetModalProps) {
  const theme = useTheme().gameTheme;
  const hand = spec.badges.find((badge) => badge.id === "hand");
  const zones = spec.badges.filter((badge) => badge.zone);
  const commanderDamage = spec.badges.filter((badge) => badge.id.startsWith("cmd-"));
  const states = spec.badges.filter(
    (badge) => badge.id !== "hand" && !badge.zone && !badge.id.startsWith("cmd-"),
  );

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <Modal.Header onClose={onClose} className="shrink-0">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-text-on-tinted"
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
            <p className="text-xs text-muted-foreground">
              {spec.isSelf ? "You" : spec.isBot ? "Bot player" : "Player details"}
            </p>
          </div>
          <div className="shrink-0 text-right" style={{ color: theme.life }}>
            <div className="text-3xl font-bold leading-none tabular-nums">{spec.life}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide">Life</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
          {spec.isActiveTurn && (
            <span className="rounded-full border border-active-action-active/30 bg-active-action-active/10 px-2 py-1 text-active-action-active">
              Active turn
            </span>
          )}
          {spec.isPriorityPlayer && (
            <span className="rounded-full border border-active-action-priority/30 bg-active-action-priority/10 px-2 py-1 text-active-action-priority">
              Has priority
            </span>
          )}
          {spec.isDisconnected && (
            <span className="rounded-full border border-border bg-muted/40 px-2 py-1 text-muted-foreground">
              Disconnected
            </span>
          )}
          {spec.isEliminated && (
            <span className="rounded-full border border-pt-lethal/30 bg-pt-lethal/10 px-2 py-1 text-pt-lethal">
              Eliminated
            </span>
          )}
          {spec.inCombat && (
            <span
              className={cn(
                "rounded-full border px-2 py-1",
                spec.combatLethal
                  ? "border-pt-lethal/30 bg-pt-lethal/10 text-pt-lethal"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
            >
              {spec.combatLethal ? "Lethal combat damage incoming" : "In combat"}
            </span>
          )}
        </div>
      </Modal.Header>

      <Modal.Body className="min-h-0 space-y-6">
        <div className="grid gap-5 md:grid-cols-2">
          <section aria-label="Cards and zones">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Cards and zones</h3>
            <div className="grid grid-cols-2 gap-2">
              <HandSummary count={hand?.count ?? 0} />
              {zones.map((badge) => (
                <ResourceTile key={badge.id} badge={badge} onClose={onClose} />
              ))}
            </div>
          </section>

          <section aria-label="Floating mana">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Floating mana</h3>
            <dl className="grid grid-cols-3 gap-1.5">
              {MANA_LETTERS.map((letter) => {
                const count = spec.manaPool[letter] ?? 0;
                return (
                  <div
                    key={letter}
                    className={cn(
                      "flex min-w-0 items-center justify-between gap-2 rounded-md border bg-muted/25 px-2 py-2",
                      count === 0 && "text-muted-foreground",
                    )}
                  >
                    <dt className={cn("flex items-center", count === 0 && "opacity-45")}>
                      <ManaSymbols cost={letter} size="lg" className="mx-0" />
                    </dt>
                    <dd className="font-mono text-sm font-semibold tabular-nums">{count}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        </div>

        <PlayerRuleFacts facts={spec.ruleFacts} />

        {states.length > 0 && (
          <BadgeSection title="Player states" badges={states} onClose={onClose} />
        )}

        {commanderDamage.length > 0 && (
          <BadgeSection
            title="Commander damage by source"
            badges={commanderDamage}
            onClose={onClose}
          />
        )}
      </Modal.Body>
    </Modal>
  );
}

function HandSummary({ count }: { count: number }) {
  const visibleCards = Math.min(3, count);
  return (
    <div className="col-span-2 flex min-h-16 items-center gap-3 rounded-md border bg-muted/25 px-3 py-2">
      <div aria-hidden="true" className="relative h-12 w-16 shrink-0">
        {Array.from({ length: visibleCards }, (_, index) => (
          <ScryfallImg
            key={index}
            src={CARD_BACK_IMAGE_URL}
            alt=""
            loading="eager"
            className="absolute bottom-0 h-11 w-8 rounded-[3px] border border-border/60 object-cover shadow-sm"
            style={{
              left: 8 + index * 10,
              transform: `rotate(${(index - (visibleCards - 1) / 2) * 10}deg)`,
              transformOrigin: "50% 100%",
            }}
          />
        ))}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Cards in hand</p>
        <p className="font-mono text-xl font-bold tabular-nums">{count}</p>
      </div>
    </div>
  );
}

function ResourceTile({ badge, onClose }: { badge: PlayerHudBadge; onClose: () => void }) {
  const content = (
    <>
      <GameIcon
        name={badge.icon as GameIconName}
        className="h-4 w-4 shrink-0"
        style={{ color: badge.color }}
      />
      <span className="min-w-0 flex-1 truncate text-xs">{badge.label}</span>
      <span className="font-mono text-sm font-bold tabular-nums">{badge.count ?? 0}</span>
    </>
  );
  const className =
    "flex min-h-11 w-full items-center gap-2 rounded-md border bg-muted/25 px-2.5 py-2 text-left";

  return badge.onTap ? (
    <button
      type="button"
      className={cn(
        className,
        "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      onClick={() => {
        onClose();
        badge.onTap?.();
      }}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function BadgeSection({
  title,
  badges,
  onClose,
}: {
  title: string;
  badges: PlayerHudBadge[];
  onClose: () => void;
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{title}</h3>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {badges.map((badge) => (
          <li key={badge.id} className={cn(badge.id === "ring" && "sm:col-span-2")}>
            <BadgeRow badge={badge} onClose={onClose} />
            {badge.id === "ring" && (
              <ol className="mb-2 ml-8 mt-2 list-decimal space-y-2 pl-4 text-xs">
                {RING_ABILITIES.map((ability, index) => {
                  const active = index < (badge.count ?? 0);
                  return (
                    <li key={ability} className={cn(!active && "text-muted-foreground")}>
                      <span className="font-semibold">{active ? "Active: " : "Not gained: "}</span>
                      {ability}
                    </li>
                  );
                })}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function BadgeRow({ badge, onClose }: { badge: PlayerHudBadge; onClose: () => void }) {
  const content = (
    <>
      <GameIcon
        name={badge.icon as GameIconName}
        className="h-4 w-4 shrink-0"
        style={{ color: badge.color }}
      />
      <span className="min-w-0 flex-1 break-words">{badge.label}</span>
      {badge.lethal && (
        <span className="shrink-0 text-xs font-semibold text-pt-lethal">Lethal</span>
      )}
      {badge.count !== undefined && (
        <span
          className={cn(
            "shrink-0 font-mono font-bold tabular-nums",
            badge.lethal && "text-pt-lethal",
          )}
        >
          {badge.count}
        </span>
      )}
      {badge.onTap && <span className="shrink-0 text-xs text-muted-foreground">View</span>}
    </>
  );
  const className = cn(
    "flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm",
    badge.lethal ? "bg-pt-lethal/10" : "bg-muted/20",
  );

  return badge.onTap ? (
    <button
      type="button"
      className={cn(
        className,
        "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      onClick={() => {
        onClose();
        badge.onTap?.();
      }}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
