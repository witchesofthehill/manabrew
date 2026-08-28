import { useState } from "react";
import {
  CreditCard,
  FlaskConical,
  Gauge,
  LayoutGrid,
  MessageSquareText,
  RotateCcw,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGameDevStore } from "@/stores/useGameDevStore";

import { BattlefieldKeywordDevControls } from "./BattlefieldKeywordDevControls";
import { BattlefieldStyleDevControls } from "./BattlefieldStyleDevControls";
import { DevCardLayoutControls } from "./DevCardLayoutControls";
import { BoardDevControls } from "./BoardDevControls";
import { CardBadgeDevControls } from "./CardBadgeDevControls";
import { CardRailDevControls } from "./CardRailDevControls";
import { DevSizingControls } from "./DevSizingControls";
import { DevStressPresets } from "./DevStressPresets";
import { PlayerBadgeDevControls } from "./PlayerBadgeDevControls";
import { PromptDevControls } from "./PromptDevControls";

type DevWorkspace = "card" | "player" | "board" | "prompt" | "stress";

interface WorkspaceTab {
  id: DevWorkspace;
  label: string;
  icon: LucideIcon;
}

const WORKSPACES: WorkspaceTab[] = [
  { id: "card", label: "Card", icon: CreditCard },
  { id: "player", label: "Player", icon: UserRound },
  { id: "board", label: "Board", icon: LayoutGrid },
  { id: "prompt", label: "Prompt", icon: MessageSquareText },
  { id: "stress", label: "Stress", icon: Gauge },
];

function activeValueCount(values: object): number {
  let count = 0;
  for (const key in values) {
    const value = (values as Record<string, unknown>)[key];
    if (value === true || typeof value === "number") count += 1;
  }
  return count;
}

export function GameDevPanel() {
  const [workspace, setWorkspace] = useState<DevWorkspace>("card");
  const cardOverrides = useGameDevStore((s) => s.cardOverrides);
  const playerOverrides = useGameDevStore((s) => s.playerOverrides);
  const keywordCount = useGameDevStore((s) => s.debugBattlefieldKeywords.length);
  const debugCardEnabled = useGameDevStore((s) => s.debugCardEnabled);
  const debugCardRailEnabled = useGameDevStore((s) => s.debugCardRailEnabled);
  const promptActionOverride = useGameDevStore((s) => s.promptActionOverride);
  const debugViewportPreset = useGameDevStore((s) => s.debugViewportPreset);
  const showHoverAreas = useGameDevStore((s) => s.showHoverAreas);
  const showGridSkeleton = useGameDevStore((s) => s.showGridSkeleton);
  const showAttackRows = useGameDevStore((s) => s.showAttackRows);
  const devToolsEnabled = useGameDevStore((s) => s.devToolsEnabled);
  const resetDevSettings = useGameDevStore((s) => s.resetDevSettings);

  const counts: Record<DevWorkspace, number> = {
    card:
      activeValueCount(cardOverrides) +
      keywordCount +
      Number(debugCardEnabled) +
      Number(debugCardRailEnabled),
    player: activeValueCount(playerOverrides),
    board:
      Number(showHoverAreas) +
      Number(showGridSkeleton) +
      Number(showAttackRows) +
      Number(devToolsEnabled) +
      Number(debugViewportPreset !== "native"),
    prompt: promptActionOverride == null ? 0 : 1,
    stress: 0,
  };
  const activeCount = counts.card + counts.player + counts.board + counts.prompt + counts.stress;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="rounded-xl border border-border/70 bg-muted/20 p-3 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Battlefield lab</h2>
              {activeCount > 0 ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">
                  {activeCount} active
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Stage card, player, board, and prompt visuals without changing the game.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0 text-muted-foreground"
            onClick={resetDevSettings}
          >
            <RotateCcw />
            Reset lab
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-5 gap-1 rounded-lg bg-muted/50 p-1" role="tablist">
          {WORKSPACES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={workspace === id}
              className={cn(
                "flex min-w-0 items-center justify-center gap-1 rounded-md px-1 py-2 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:gap-1.5 sm:px-2 sm:text-xs",
                workspace === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
              onClick={() => setWorkspace(id)}
            >
              <Icon className="hidden h-3.5 w-3.5 sm:block" />
              <span>{label}</span>
              {counts[id] > 0 ? (
                <span className="min-w-4 rounded-full bg-primary/10 px-1 font-mono text-[9px] text-primary">
                  {counts[id]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" className="flex flex-col gap-3">
        {workspace === "card" ? (
          <>
            <BattlefieldStyleDevControls />
            <BattlefieldKeywordDevControls />
            <DevCardLayoutControls />
            <CardBadgeDevControls />
            {import.meta.env.DEV ? <CardRailDevControls /> : null}
          </>
        ) : null}
        {workspace === "player" ? <PlayerBadgeDevControls /> : null}
        {workspace === "board" ? (
          <>
            <DevSizingControls />
            <BoardDevControls />
          </>
        ) : null}
        {workspace === "prompt" ? <PromptDevControls /> : null}
        {workspace === "stress" ? <DevStressPresets /> : null}
      </div>
    </div>
  );
}
