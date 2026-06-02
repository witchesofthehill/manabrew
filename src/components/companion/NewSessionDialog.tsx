import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  COMPANION_COMMANDER_STARTING_LIFE,
  COMPANION_DEFAULT_LAYOUT_BY_COUNT,
  COMPANION_DEFAULT_PLAYER_COUNT,
  COMPANION_DEFAULT_STARTING_LIFE,
  COMPANION_LAYOUT_LABELS,
  COMPANION_LAYOUT_OPTIONS,
  COMPANION_MAX_PLAYERS,
  COMPANION_MIN_PLAYERS,
  COMPANION_STARTING_LIFE_PRESETS,
} from "@/stores/useCompanionStore.constants";
import type { CompanionLayout } from "@/stores/useCompanionStore.types";
import { LayoutIcon } from "./LayoutIcon";

interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasExistingSession: boolean;
  onCreate: (input: {
    playerCount: number;
    startingLife: number;
    commanderRules: boolean;
    layout: CompanionLayout;
    carryRoster: boolean;
  }) => void;
}

export function NewSessionDialog({
  open,
  onOpenChange,
  hasExistingSession,
  onCreate,
}: NewSessionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New game</DialogTitle>
        </DialogHeader>
        {open && (
          <NewSessionForm
            hasExistingSession={hasExistingSession}
            onCancel={() => onOpenChange(false)}
            onCreate={onCreate}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewSessionForm({
  hasExistingSession,
  onCancel,
  onCreate,
}: {
  hasExistingSession: boolean;
  onCancel: () => void;
  onCreate: NewSessionDialogProps["onCreate"];
}) {
  const [playerCount, setPlayerCount] = useState(COMPANION_DEFAULT_PLAYER_COUNT);
  const [commanderRules, setCommanderRules] = useState(false);
  const [startingLife, setStartingLife] = useState(COMPANION_DEFAULT_STARTING_LIFE);
  const [layout, setLayout] = useState<CompanionLayout>(
    COMPANION_DEFAULT_LAYOUT_BY_COUNT[COMPANION_DEFAULT_PLAYER_COUNT] ?? "1v1",
  );
  const [carryRoster, setCarryRoster] = useState(hasExistingSession);

  const updatePlayerCount = (n: number) => {
    setPlayerCount(n);
    setLayout(COMPANION_DEFAULT_LAYOUT_BY_COUNT[n] ?? "free");
  };

  const updateCommanderRules = (enabled: boolean) => {
    setCommanderRules(enabled);
    if (enabled && startingLife < COMPANION_COMMANDER_STARTING_LIFE) {
      setStartingLife(COMPANION_COMMANDER_STARTING_LIFE);
    }
  };

  const layoutChoices = COMPANION_LAYOUT_OPTIONS[playerCount] ?? ["free"];

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1">
          <Label>Players</Label>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(
              { length: COMPANION_MAX_PLAYERS - COMPANION_MIN_PLAYERS + 1 },
              (_, i) => i + COMPANION_MIN_PLAYERS,
            ).map((n) => (
              <PillButton key={n} active={n === playerCount} onClick={() => updatePlayerCount(n)}>
                {n}
              </PillButton>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label>Starting life</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {COMPANION_STARTING_LIFE_PRESETS.map((value) => (
              <PillButton
                key={value}
                active={value === startingLife}
                onClick={() => setStartingLife(value)}
              >
                {value}
              </PillButton>
            ))}
            <Input
              type="number"
              value={startingLife}
              onChange={(e) =>
                setStartingLife(Math.max(1, Number.parseInt(e.target.value, 10) || 1))
              }
              className="w-20"
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={commanderRules}
            onChange={(e) => updateCommanderRules(e.target.checked)}
            className="size-4 accent-primary"
          />
          Commander rules (40 life, 21 cmd damage lethal)
        </label>

        <div className="space-y-1">
          <Label>Layout</Label>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {layoutChoices.map((option) => (
              <LayoutCard
                key={option}
                active={option === layout}
                onClick={() => setLayout(option)}
                layout={option}
                label={COMPANION_LAYOUT_LABELS[option]}
              />
            ))}
          </div>
        </div>

        {hasExistingSession && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={carryRoster}
              onChange={(e) => setCarryRoster(e.target.checked)}
              className="size-4 accent-primary"
            />
            Keep names, colors and commanders from current game
          </label>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() =>
            onCreate({ playerCount, startingLife, commanderRules, layout, carryRoster })
          }
        >
          Start game
        </Button>
      </DialogFooter>
    </>
  );
}

function LayoutCard({
  active,
  onClick,
  layout,
  label,
}: {
  active: boolean;
  onClick: () => void;
  layout: CompanionLayout;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-md border p-2 text-center text-[11px] font-medium transition",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      aria-pressed={active}
      aria-label={label}
      title={label}
    >
      <LayoutIcon layout={layout} className="size-9" />
      <span className="truncate leading-tight">{label}</span>
    </button>
  );
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
