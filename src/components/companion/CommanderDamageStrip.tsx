import { useState } from "react";
import { GameIcon } from "./GameIcon";
import { cn } from "@/lib/utils";
import {
  COMPANION_ACCENT_COLORS,
  COMPANION_LETHAL_COMMANDER_DAMAGE,
} from "@/stores/useCompanionStore.constants";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { CommanderArt } from "./CommanderArt";
import { CommanderDamageDialog } from "./CommanderDamageDialog";

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
  const [open, setOpen] = useState(false);
  const damagePair = target.commanderDamage[source.id] ?? [0, 0];
  const totalDamage = damagePair[0] + damagePair[1];
  const lethal = damagePair.some((d) => d >= COMPANION_LETHAL_COMMANDER_DAMAGE);
  const accentColor = COMPANION_ACCENT_COLORS[source.accentKey];

  return (
    <>
      <button
        type="button"
        className="group relative size-8 overflow-hidden rounded-full transition active:scale-95 @md:size-10"
        style={{
          backgroundColor: accentColor,
          boxShadow: `0 0 0 2.5px ${accentColor}, 0 0 0 4px rgba(0,0,0,0.5)`,
        }}
        onClick={() => setOpen(true)}
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
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold text-white",
              lethal ? "bg-destructive" : "bg-black/80",
            )}
          >
            {totalDamage}
          </span>
        )}
      </button>
      <CommanderDamageDialog target={target} source={source} open={open} onOpenChange={setOpen} />
    </>
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
