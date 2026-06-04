import { GameIcon } from "./GameIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import {
  COMPANION_ACCENT_COLORS,
  COMPANION_LETHAL_COMMANDER_DAMAGE,
} from "@/stores/useCompanionStore.constants";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { usePressHold } from "./usePressHold";
import { CommanderArt } from "./CommanderArt";

interface CommanderDamageStripProps {
  target: CompanionPlayer;
  opponents: CompanionPlayer[];
  className?: string;
}

export function CommanderDamageStrip({ target, opponents, className }: CommanderDamageStripProps) {
  if (opponents.length === 0) return null;
  return (
    <div className={cn("flex flex-col items-center gap-1 @md:gap-1.5", className)}>
      <GameIcon icon="crossed-swords" className="size-3 text-white/60 @md:size-3.5" />
      {opponents.map((source) => (
        <CommanderDamageButton key={source.id} target={target} source={source} />
      ))}
    </div>
  );
}

function CommanderDamageButton({
  target,
  source,
}: {
  target: CompanionPlayer;
  source: CompanionPlayer;
}) {
  const damagePair = target.commanderDamage[source.id] ?? [0, 0];
  const totalDamage = damagePair[0] + damagePair[1];
  const lethal = damagePair.some((d) => d >= COMPANION_LETHAL_COMMANDER_DAMAGE);
  const accentColor = COMPANION_ACCENT_COLORS[source.accentKey];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group relative size-7 overflow-hidden rounded-full ring-2 transition @md:size-9",
            lethal ? "ring-destructive" : "ring-white/30 hover:ring-white/60",
          )}
          style={{ backgroundColor: accentColor }}
          aria-label={`Commander damage from ${source.name}: ${totalDamage}`}
        >
          {source.commanders[0]?.imageUrl ? (
            <CommanderArt
              refs={source.commanders}
              variant="avatar"
              className="absolute inset-0 size-full"
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-[10px] font-semibold uppercase text-white">
              {initials(source.name)}
            </span>
          )}
          {totalDamage > 0 && (
            <span className="absolute -bottom-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-black/80 px-1 text-[10px] font-bold text-white">
              {totalDamage}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="left" sideOffset={6} className="w-60 p-2">
        <div className="flex items-center gap-2 px-1 pb-1 text-xs text-muted-foreground">
          Damage from <span className="font-semibold text-foreground">{source.name}</span>
        </div>
        <DamageStepper target={target} source={source} slot={0} />
        {source.commanders[1] && <DamageStepper target={target} source={source} slot={1} />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DamageStepper({
  target,
  source,
  slot,
}: {
  target: CompanionPlayer;
  source: CompanionPlayer;
  slot: 0 | 1;
}) {
  const adjust = useCompanionStore((s) => s.adjustCommanderDamage);
  const damage = (target.commanderDamage[source.id] ?? [0, 0])[slot];
  const label = source.commanders[slot]?.name ?? (slot === 0 ? "Commander" : "Partner");

  const dec = usePressHold({
    onTap: () => adjust(target.id, source.id, slot, -1),
    onHoldTick: () => adjust(target.id, source.id, slot, -1),
  });
  const inc = usePressHold({
    onTap: () => adjust(target.id, source.id, slot, 1),
    onHoldTick: () => adjust(target.id, source.id, slot, 1),
  });

  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
      <span className="flex-1 truncate text-xs" title={label}>
        {label}
      </span>
      <button
        type="button"
        className="grid size-6 place-items-center rounded-sm bg-background hover:bg-accent"
        aria-label="Decrease commander damage"
        {...dec}
      >
        −
      </button>
      <span
        className={cn(
          "min-w-6 text-center tabular-nums text-sm font-semibold",
          damage >= COMPANION_LETHAL_COMMANDER_DAMAGE && "text-destructive",
        )}
      >
        {damage}
      </span>
      <button
        type="button"
        className="grid size-6 place-items-center rounded-sm bg-background hover:bg-accent"
        aria-label="Increase commander damage"
        {...inc}
      >
        +
      </button>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
