import { Button } from "@/components/ui/button";
import { CardRenderingCharacteristicControls } from "@/components/dev/CardRenderingCharacteristicControls";
import { CardRenderingCounterControls } from "@/components/dev/CardRenderingCounterControls";
import {
  DEV_CONTROL_ACTIVE,
  DEV_CONTROL_BUTTON,
  DEV_CONTROL_INACTIVE,
  DEV_SECTION_HEADING,
} from "@/components/dev/devPanel.styles";
import { cn } from "@/lib/utils";
import type {
  CardRenderingOverrides,
  CardRenderingStatus,
} from "@/components/dev/cardRenderingOverrides";
import type { ClientCardDto } from "@/stores/gameStore.types";

interface CardRenderingStateControlsProps {
  card: ClientCardDto | undefined;
  value: CardRenderingOverrides;
  onChange: (value: CardRenderingOverrides) => void;
  onReset: () => void;
}

const STATUSES: { key: CardRenderingStatus; label: string }[] = [
  { key: "tapped", label: "Tapped" },
  { key: "summoningSick", label: "Summoning sick" },
  { key: "exerted", label: "Exerted" },
  { key: "phasedOut", label: "Phased out" },
  { key: "isPlotted", label: "Plotted" },
  { key: "isWarpExiled", label: "Warped" },
  { key: "isBestowed", label: "Bestowed" },
  { key: "isCopy", label: "Copy" },
  { key: "isFaceDown", label: "Face down" },
  { key: "isAttacking", label: "Attacking" },
  { key: "isCrewed", label: "Crewed" },
  { key: "isMadnessExiled", label: "Madness exiled" },
  { key: "isRingBearer", label: "Ring-bearer" },
  { key: "wouldDieInCombat", label: "Dies in combat" },
];

export function CardRenderingStateControls({
  card,
  value,
  onChange,
  onReset,
}: CardRenderingStateControlsProps) {
  return (
    <section
      aria-label="Local rendering state"
      className="rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className={DEV_SECTION_HEADING}>Local card state</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Both renderers only. No game state or saved deck changes.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={Object.keys(value).length === 0}
          onClick={onReset}
        >
          Reset local edits
        </Button>
      </div>
      {card ? (
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
          <details className="rounded-md border border-border/70 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium">
              Types, P/T, damage & keywords
            </summary>
            <div className="mt-3">
              <CardRenderingCharacteristicControls card={card} value={value} onChange={onChange} />
            </div>
          </details>
          <details className="rounded-md border border-border/70 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium">Status badges</summary>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {STATUSES.map(({ key, label }) => (
                <label
                  key={key}
                  className={cn(
                    DEV_CONTROL_BUTTON,
                    "flex cursor-pointer items-center gap-2",
                    card[key] ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
                  )}
                >
                  <input
                    type="checkbox"
                    checked={card[key]}
                    onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
                  />
                  {label}
                </label>
              ))}
              <label
                className={cn(
                  DEV_CONTROL_BUTTON,
                  "flex cursor-pointer items-center gap-2",
                  card.identity.isToken ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
                )}
              >
                <input
                  type="checkbox"
                  checked={card.identity.isToken}
                  onChange={(event) => onChange({ ...value, isToken: event.target.checked })}
                />
                Token
              </label>
            </div>
          </details>
          <details className="rounded-md border border-border/70 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium">Counters</summary>
            <div className="mt-3">
              <CardRenderingCounterControls card={card} value={value} onChange={onChange} />
            </div>
          </details>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Load a fixture to edit its state.</p>
      )}
    </section>
  );
}
