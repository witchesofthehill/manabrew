import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  Flag,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGameStore } from "@/stores/useGameStore";
import { withAlpha } from "@/themes/gameTheme";
import { getPlatformType } from "@/platform";

interface MiddleBarDockProps {
  /** Controlled open state — the trigger is the Pixi gear in the self panel. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConcede: () => void;
  isMyPriority: boolean;
  sidePanelCollapsed: boolean;
  onToggleSidePanel: () => void;
  /** Every seat, for the per-player playmat show/hide toggles. `color` is the
   *  player's seat colour, used to tint the row on hover so it's clear who's who. */
  players: { id: string; name: string; color: string }[];
}

/** Board menu opened by the self panel's Pixi gear — fullscreen, the dev/side
 *  panel toggle, and concede. Controlled; the trigger is just a positioning
 *  anchor near the gear. */
export function MiddleBarDock({
  open,
  onOpenChange,
  onConcede,
  isMyPriority,
  sidePanelCollapsed,
  onToggleSidePanel,
  players,
}: MiddleBarDockProps) {
  const isWeb = getPlatformType() === "web";
  const hiddenPlaymats = useGameStore((s) => s.hiddenPlaymats);
  const togglePlaymatHidden = useGameStore((s) => s.togglePlaymatHidden);
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
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      {/* The visible trigger is the Pixi gear in the self panel; this is just a
          zero-size anchor near it for the menu to position against. */}
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none absolute bottom-14 left-6 h-0 w-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        {isWeb && (
          <DropdownMenuItem onSelect={() => toggleFullscreen()}>
            <FullscreenIcon className="mr-2 h-4 w-4" />
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onToggleSidePanel()}>
          <PanelIcon className="mr-2 h-4 w-4" />
          {sidePanelCollapsed ? "Show side panel" : "Hide side panel"}
        </DropdownMenuItem>
        {players.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ImageIcon className="mr-2 h-4 w-4" />
              Playmats
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuLabel>Hide playmat</DropdownMenuLabel>
              {players.map((p) => (
                <DropdownMenuCheckboxItem
                  key={p.id}
                  checked={hiddenPlaymats.has(p.id)}
                  onCheckedChange={() => togglePlaymatHidden(p.id)}
                  onSelect={(e) => e.preventDefault()}
                  style={{ "--player-hover": withAlpha(p.color, 0.28) } as CSSProperties}
                  className="focus:bg-[var(--player-hover)] focus:text-foreground"
                >
                  {p.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!isMyPriority}
          className="text-destructive focus:text-destructive"
          onSelect={(event) => {
            event.preventDefault();
            if (isMyPriority) onConcede();
          }}
          title={isMyPriority ? undefined : "Wait until you have priority to concede"}
        >
          <Flag className="mr-2 h-4 w-4" />
          Concede
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
