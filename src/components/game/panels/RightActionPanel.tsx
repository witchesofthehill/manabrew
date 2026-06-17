import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { PanelRightOpen, PanelRightClose } from "lucide-react";
import type { RightActionPanelProps } from "../game.types";
import { TAB_BUTTON_BASE, TAB_ACTIVE, TAB_INACTIVE } from "../game.styles";
import { ActionLog } from "./ActionLog";
import { SnapshotsPanel } from "./SnapshotsPanel";
import {
  DEV_PROMPT_ACTION_OVERRIDES,
  type DevPromptActionOverride,
  useGameDevStore,
} from "@/stores/useGameDevStore";
import { PlayerBadgeDevControls } from "@/components/dev/PlayerBadgeDevControls";
import { CardBadgeDevControls } from "@/components/dev/CardBadgeDevControls";
import { BattlefieldKeywordDevControls } from "@/components/dev/BattlefieldKeywordDevControls";

const DEV_LABELS: Record<DevPromptActionOverride, string> = {
  chooseAction: "ChooseAction",
  chooseAttackers: "ChooseAttackers",
  chooseBlockers: "ChooseBlockers",
  chooseTargetSpell: "ChooseTargetSpell",
  payManaCost: "PayManaCost",
  noAction: "NoAction",
};

export function RightActionPanel({
  collapsed,
  onToggleCollapse: rawToggle,
  gameLog,
  onHoverLogCard,
  resolveCardName,
  resolvePlayerName,
  snapshots,
  canRestoreSnapshots,
  onRestoreSnapshot,
}: RightActionPanelProps) {
  const visibleLog = gameLog.filter((entry) => entry.entryType !== "rule");
  const promptActionOverride = useGameDevStore((s) => s.promptActionOverride);
  const devToolsEnabled = useGameDevStore((s) => s.devToolsEnabled);
  const setPromptActionOverride = useGameDevStore((s) => s.setPromptActionOverride);
  const setDevToolsEnabled = useGameDevStore((s) => s.setDevToolsEnabled);
  const clearPromptActionOverride = useGameDevStore((s) => s.clearPromptActionOverride);
  const triggerEtbGlow = useGameDevStore((s) => s.triggerEtbGlow);

  const [activeTab, setActiveTab] = useState<"log" | "snapshots" | "dev">("log");

  if (collapsed) {
    return (
      <aside className="absolute top-1.5 right-1.5 z-50">
        <Button
          size="icon"
          variant="outline"
          className={cn(
            "h-8 w-8 bg-card/95 backdrop-blur-sm",
            "border-border/70 shadow-[0_10px_30px_rgba(0,0,0,0.35)]",
            "text-muted-foreground hover:text-foreground hover:bg-accent/80",
            "active:bg-accent",
          )}
          onClick={rawToggle}
          title="Open right panel"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="absolute right-1.5 top-1.5 bottom-1.5 z-50 w-72 rounded-lg bg-card/95 backdrop-blur-sm transition-colors overflow-visible border border-border/70 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
      <div className="h-full p-3 flex flex-col gap-3 overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <button
              className={cn(TAB_BUTTON_BASE, activeTab === "log" ? TAB_ACTIVE : TAB_INACTIVE)}
              onClick={() => setActiveTab("log")}
            >
              Log ({visibleLog.length})
            </button>
            <button
              className={cn(TAB_BUTTON_BASE, activeTab === "snapshots" ? TAB_ACTIVE : TAB_INACTIVE)}
              onClick={() => setActiveTab("snapshots")}
            >
              Snapshots ({snapshots.length})
            </button>
            <button
              className={cn(TAB_BUTTON_BASE, activeTab === "dev" ? TAB_ACTIVE : TAB_INACTIVE)}
              onClick={() => setActiveTab("dev")}
            >
              Dev
            </button>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={rawToggle}
            title="Close right panel"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </Button>
        </div>

        {activeTab === "log" ? (
          <ActionLog
            gameLog={gameLog}
            resolveCardName={resolveCardName}
            resolvePlayerName={resolvePlayerName}
            onHoverLogCard={onHoverLogCard}
          />
        ) : activeTab === "snapshots" ? (
          <SnapshotsPanel
            snapshots={snapshots}
            canRestoreSnapshots={canRestoreSnapshots}
            onRestoreSnapshot={onRestoreSnapshot}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <PixiFpsCounter />
            <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Zustand DevTools</span>
                <span className="text-xs text-muted-foreground">
                  Default off to avoid slowing the battlefield UI.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={devToolsEnabled}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
                  devToolsEnabled ? "border-primary bg-primary" : "border-border/70 bg-muted",
                )}
                onClick={() => setDevToolsEnabled(!devToolsEnabled)}
              >
                <span
                  className={cn(
                    "block h-5 w-5 rounded-full bg-background shadow-sm transition-transform",
                    devToolsEnabled ? "translate-x-5" : "translate-x-0.5",
                  )}
                />
              </button>
            </div>
            <button
              type="button"
              className="rounded-md border border-border/70 px-3 py-2 text-sm font-medium hover:bg-accent/50"
              onClick={triggerEtbGlow}
            >
              Flash ETB on board
            </button>
            <p className="text-xs text-muted-foreground">Force prompt action view (UI only).</p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                className={cn(
                  "px-2 py-1.5 rounded text-xs font-medium border",
                  promptActionOverride === null
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
                onClick={clearPromptActionOverride}
              >
                Auto
              </button>
              {DEV_PROMPT_ACTION_OVERRIDES.map((override) => (
                <button
                  key={override}
                  className={cn(
                    "px-2 py-1.5 rounded text-xs font-medium border",
                    promptActionOverride === override
                      ? "border-primary text-primary bg-primary/10"
                      : "border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/50",
                  )}
                  onClick={() => setPromptActionOverride(override)}
                >
                  {DEV_LABELS[override]}
                </button>
              ))}
            </div>
            <PlayerBadgeDevControls />
            <CardBadgeDevControls />
            <BattlefieldKeywordDevControls />
          </div>
        )}
      </div>
    </aside>
  );
}

function PixiFpsCounter() {
  const stats = useGameDevStore((s) => s.pixiPerfStats);

  if (!stats) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Pixi FPS</span>
          <span className="text-xs text-muted-foreground">Renderer inactive.</span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">—</span>
      </div>
    );
  }

  const fps = stats.fps.toFixed(1);
  const range = `${stats.minFps.toFixed(0)}–${stats.maxFps.toFixed(0)}`;
  const frameMs = stats.deltaMs.toFixed(1);
  const color =
    stats.fps >= 55 ? "text-success" : stats.fps >= 40 ? "text-warning" : "text-destructive";

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Pixi FPS</span>
        <span className="text-xs text-muted-foreground">
          frame {frameMs}ms · range {range}
        </span>
      </div>
      <span className={cn("font-mono text-lg font-semibold tabular-nums", color)}>{fps}</span>
    </div>
  );
}
