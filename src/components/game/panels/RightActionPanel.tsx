import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGameUIStore } from "@/stores/useGameUIStore";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { History, PanelRightClose } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { RightActionPanelProps } from "../game.types";
import { TAB_BUTTON_BASE, TAB_ACTIVE, TAB_INACTIVE } from "../game.styles";
import { CheckpointsPanel } from "./CheckpointsPanel";
import { GameDevPanel } from "@/components/dev/GameDevPanel";
export function RightActionPanel({
  collapsed,
  onToggleCollapse: rawToggle,
  resolvePlayerName,
  resolvePlayerColor,
  checkpoints,
  decisionHistory,
  canRequestRestore,
  onRequestRestore,
  onLeftEdgeChange,
}: RightActionPanelProps) {
  const mobile = useIsMobileGame();
  const storedActiveTab = useGameUIStore((s) => s.rightPanelTab);
  const activeTab = storedActiveTab === "dev" && !import.meta.env.DEV ? "journal" : storedActiveTab;
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

  if (collapsed) {
    return !mobile && checkpoints.length > 0 ? (
      <button
        type="button"
        className="absolute right-[calc(0.75rem+var(--safe-area-inset-right))] top-[calc(0.75rem+var(--safe-area-inset-top))] z-50 flex touch:min-h-11 touch:min-w-11 items-center gap-2 rounded-full border border-border/80 bg-card/95 px-3 py-2 font-game text-ui-label font-semibold text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-accent"
        aria-label={`Open journal with ${checkpoints.length} entries`}
        onClick={() => {
          setActiveTab("journal");
          rawToggle();
        }}
      >
        <History className="h-4 w-4 text-primary" />
        Journal
        <span className="min-w-5 rounded-full bg-muted px-1.5 py-0.5 text-ui-meta font-semibold tabular-nums lining-nums text-foreground">
          {checkpoints.length}
        </span>
      </button>
    ) : null;
  }

  return (
    <aside
      ref={panelRef}
      className={cn(
        "absolute right-[calc(0.375rem+var(--safe-area-inset-right))] top-[calc(0.375rem+var(--safe-area-inset-top))] bottom-[calc(0.375rem+var(--safe-area-inset-bottom))] z-[9001] rounded-lg bg-card/95 backdrop-blur-sm transition-[width,background-color,border-color] overflow-visible border border-border/70 shadow-[0_20px_60px_rgba(0,0,0,0.45)]",
        mobile
          ? "w-[calc(100vw_-_0.75rem_-_var(--safe-area-inset-left)_-_var(--safe-area-inset-right))]"
          : activeTab === "dev"
            ? "w-[calc(100vw_-_0.75rem_-_var(--safe-area-inset-left)_-_var(--safe-area-inset-right))] sm:w-[38rem]"
            : "w-80",
      )}
    >
      <div className="h-full p-3 flex flex-col gap-3 overflow-y-auto">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              className={cn(TAB_BUTTON_BASE, activeTab === "journal" ? TAB_ACTIVE : TAB_INACTIVE)}
              onClick={() => setActiveTab("journal")}
            >
              Journal ({checkpoints.length})
            </button>
            {import.meta.env.DEV ? (
              <button
                className={cn(TAB_BUTTON_BASE, activeTab === "dev" ? TAB_ACTIVE : TAB_INACTIVE)}
                onClick={() => setActiveTab("dev")}
              >
                Dev
              </button>
            ) : null}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 touch:min-h-11 touch:min-w-11 text-muted-foreground hover:text-foreground"
            onClick={rawToggle}
            title={`Close right panel`}
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </Button>
        </div>

        {activeTab === "journal" ? (
          <CheckpointsPanel
            checkpoints={checkpoints}
            decisionHistory={decisionHistory}
            canRequestRestore={canRequestRestore}
            onRequestRestore={onRequestRestore}
            resolvePlayerName={resolvePlayerName}
            resolvePlayerColor={resolvePlayerColor}
          />
        ) : (
          <GameDevPanel />
        )}
      </div>
    </aside>
  );
}
