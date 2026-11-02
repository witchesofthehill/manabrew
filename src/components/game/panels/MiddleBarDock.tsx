import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  Circle,
  Flag,
  Image as ImageIcon,
  Info,
  LogOut,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Repeat,
  Settings2,
  Square,
  Swords,
  Volume2,
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
import { getPlatformType } from "@/platform";
import { useKeybindings } from "@/hooks/useKeybindings";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RecordingStatus } from "@/protocol";
interface MiddleBarDockProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
  onOpenSoundSettings: () => void;
  onOpenCombat?: () => void;
  onConcede: () => void;
  eliminated: boolean;
  onLeave: () => void;
  sidePanelCollapsed: boolean;
  onToggleSidePanel: () => void;
  recording: RecordingStatus["type"];
  canRecord: boolean;
  canRepeat: boolean;
  onToggleRecording: () => void;
  onRepeat: () => void;
  /** Every seat, for the per-player playmat show/hide toggles. `color` is the
   *  player's seat colour (full opacity, matching their Pixi avatar ring) used as
   *  the row's hover background; `textColor` is the readable text over it. */
  players: {
    id: string;
    name: string;
    color: string;
    textColor: string;
  }[];
}

export function MiddleBarDock({
  open,
  onOpenChange,
  onOpenSettings,
  onOpenSoundSettings,
  onOpenCombat,
  onConcede,
  eliminated,
  onLeave,
  sidePanelCollapsed,
  onToggleSidePanel,
  recording,
  canRecord,
  canRepeat,
  onToggleRecording,
  onRepeat,
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
  useKeybindings({ "toggle-fullscreen": toggleFullscreen });
  const FullscreenIcon = isFullscreen ? Minimize2 : Maximize2;
  const PanelIcon = sidePanelCollapsed ? PanelRightOpen : PanelRightClose;
  const repeatHint = canRepeat
    ? null
    : recording === "ready"
      ? `You can replay when you have priority and the stack is empty.`
      : recording === "recording"
        ? `Stop recording to replay the combo.`
        : `Record a combo first.`;
  const repeatItem = (
    <DropdownMenuItem
      aria-disabled={!canRepeat}
      className={cn(!canRepeat && "text-muted-foreground opacity-60")}
      onSelect={(e) => {
        if (!canRepeat) {
          e.preventDefault();
          return;
        }
        onRepeat();
      }}
    >
      <Repeat className="mr-2 h-4 w-4" />
      Replay combo
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none absolute bottom-14 right-6 h-0 w-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        {isWeb && (
          <DropdownMenuItem onSelect={() => toggleFullscreen()}>
            <FullscreenIcon className="mr-2 h-4 w-4" />
            {isFullscreen ? `Exit full screen` : `Full screen`}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onToggleSidePanel()}>
          <PanelIcon className="mr-2 h-4 w-4" />
          {sidePanelCollapsed ? `Show side panel` : `Hide side panel`}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onOpenSettings()}>
          <Settings2 className="mr-2 h-4 w-4" />
          Board settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenSoundSettings}>
          <Volume2 className="mr-2 h-4 w-4" />
          Sound settings
        </DropdownMenuItem>
        {onOpenCombat && (
          <DropdownMenuItem onSelect={onOpenCombat}>
            <Swords className="mr-2 h-4 w-4" />
            Combat breakdown
          </DropdownMenuItem>
        )}
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
                  style={{ "--player-bg": p.color, "--player-fg": p.textColor } as CSSProperties}
                  className="focus:bg-[var(--player-bg)] focus:text-[var(--player-fg)]"
                >
                  {p.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5">
          Combo recorder
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} aria-label="About the combo recorder">
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-64">
              Record your combo once, then replay it as many times as you want.
            </TooltipContent>
          </Tooltip>
        </DropdownMenuLabel>
        {(recording === "recording" || canRecord) && (
          <DropdownMenuItem
            disabled={!canRecord}
            onSelect={(e) => {
              if (recording === "recording") e.preventDefault();
              onToggleRecording();
            }}
          >
            {recording === "recording" ? (
              <Square className="mr-2 h-4 w-4 fill-current" />
            ) : (
              <Circle className="mr-2 h-4 w-4 fill-current text-destructive" />
            )}
            {recording === "recording" ? `Stop recording` : `Record combo`}
          </DropdownMenuItem>
        )}
        {repeatHint ? (
          <Tooltip>
            <TooltipTrigger asChild>{repeatItem}</TooltipTrigger>
            <TooltipContent side="left">{repeatHint}</TooltipContent>
          </Tooltip>
        ) : (
          repeatItem
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => {
            if (eliminated) onLeave();
            else onConcede();
          }}
        >
          {eliminated ? <LogOut className="mr-2 h-4 w-4" /> : <Flag className="mr-2 h-4 w-4" />}
          {eliminated ? `Leave` : `Concede`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
