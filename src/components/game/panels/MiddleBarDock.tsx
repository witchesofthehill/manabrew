import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getPlatformType } from "@/platform";
import { cn } from "@/lib/utils";

interface MiddleBarDockProps {
  /** Canvas-CSS px Y of the center divider line (from BoardCanvasLayout). */
  top: number;
  onConcede: () => void;
  isMyPriority: boolean;
  sidePanelCollapsed: boolean;
  onToggleSidePanel: () => void;
}

const DOCK_BUTTON_CLASS = cn(
  "h-7 w-7 rounded-md border border-border/70 bg-card/95 text-muted-foreground backdrop-blur-sm",
  "shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition hover:border-primary/60 hover:text-foreground hover:bg-accent/80",
);

export function MiddleBarDock({
  top,
  onConcede,
  isMyPriority,
  sidePanelCollapsed,
  onToggleSidePanel,
}: MiddleBarDockProps) {
  const isWeb = getPlatformType() === "web";
  const [isFullscreen, setIsFullscreen] = useState(
    typeof document !== "undefined" && document.fullscreenElement !== null,
  );

  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!isWeb) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      const target = e.target as HTMLElement | null;
      if (target?.matches?.("input, textarea, [contenteditable='true']")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen, isWeb]);

  const FullscreenIcon = isFullscreen ? Minimize2 : Maximize2;
  const PanelIcon = sidePanelCollapsed ? PanelRightOpen : PanelRightClose;

  return (
    <div
      className="absolute left-1.5 z-50 flex -translate-y-1/2 flex-row items-center gap-1.5"
      style={{ top }}
    >
      <Button
        size="icon"
        variant="outline"
        className={DOCK_BUTTON_CLASS}
        onClick={onToggleSidePanel}
        title={sidePanelCollapsed ? "Open right panel" : "Close right panel"}
      >
        <PanelIcon className="h-3.5 w-3.5" />
      </Button>
      {isWeb && (
        <Button
          size="icon"
          variant="outline"
          className={DOCK_BUTTON_CLASS}
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen (F)" : "Enter fullscreen (F)"}
        >
          <FullscreenIcon className="h-3.5 w-3.5" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="outline" className={DOCK_BUTTON_CLASS} title="Settings">
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="left">
          <DropdownMenuItem
            disabled={!isMyPriority}
            className="text-destructive focus:text-destructive"
            onSelect={(event) => {
              event.preventDefault();
              if (!isMyPriority) return;
              onConcede();
            }}
            onClick={() => {
              if (!isMyPriority) return;
              onConcede();
            }}
            title={isMyPriority ? undefined : "Wait until you have priority to concede"}
          >
            Concede
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
