import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGameUIStore } from "@/stores/useGameUIStore";
import { PanelRightClose } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { RightActionPanelProps } from "../game.types";
import { TAB_BUTTON_BASE, TAB_ACTIVE, TAB_INACTIVE } from "../game.styles";
import { ActionLog } from "./ActionLog";
import { SnapshotsPanel } from "./SnapshotsPanel";
import { GameDevPanel } from "@/components/dev/GameDevPanel";

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
  onLeftEdgeChange,
}: RightActionPanelProps) {
  const visibleLog = gameLog.filter((entry) => entry.entryType !== "rule");

  const activeTab = useGameUIStore((s) => s.rightPanelTab);
  const setActiveTab = useGameUIStore((s) => s.setRightPanelTab);
  const panelRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !onLeftEdgeChange) return;
    const measure = () => onLeftEdgeChange(panel.getBoundingClientRect().left);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    if (panel.parentElement) observer.observe(panel.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      onLeftEdgeChange(undefined);
    };
  }, [collapsed, onLeftEdgeChange]);

  if (collapsed) return null;

  return (
    <aside
      ref={panelRef}
      className={cn(
        "absolute right-[calc(0.375rem+var(--safe-area-inset-right))] top-[calc(0.375rem+var(--safe-area-inset-top))] bottom-[calc(0.375rem+var(--safe-area-inset-bottom))] z-50 rounded-lg bg-card/95 backdrop-blur-sm transition-[width,background-color,border-color] overflow-visible border border-border/70 shadow-[0_20px_60px_rgba(0,0,0,0.45)]",
        activeTab === "dev"
          ? "w-[calc(100vw_-_0.75rem_-_var(--safe-area-inset-left)_-_var(--safe-area-inset-right))] sm:w-[38rem]"
          : "w-72",
      )}
    >
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
            className="h-7 w-7 pointer-coarse:h-10 pointer-coarse:w-10 text-muted-foreground hover:text-foreground"
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
          <GameDevPanel />
        )}
      </div>
    </aside>
  );
}
