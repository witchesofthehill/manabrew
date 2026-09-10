import { useState } from "react";
import { ChevronRight, EyeOff, Moon, Redo2, Sun, SunMoon, Undo2 } from "lucide-react";
import { LayoutIcon } from "./LayoutIcon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import {
  COMPANION_ACCENT_COLORS,
  COMPANION_LAYOUT_LABELS,
  COMPANION_LAYOUT_OPTIONS,
} from "@/stores/useCompanionStore.constants";
import type { CompanionSession } from "@/stores/useCompanionStore.types";
import { DiceMenu } from "./DiceMenu";
import { FocusModeButton } from "./FocusModeButton";
import { GameLog } from "./GameLog";
import { SetupMenu } from "./SetupMenu";
import { TurnTimer } from "./TurnTimer";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface CompanionBarProps {
  session: CompanionSession;
  onOpenNewSession: () => void;
  focus: boolean;
  onToggleFocus: (next: boolean) => void;
  /** When set, the bar is being rendered as the focus-mode peek overlay
   *  — show a hide-peek control alongside Focus so the user can collapse
   *  the chrome back down without exiting focus mode. */
  onHidePeek?: () => void;
}
export function CompanionBar({
  session,
  onOpenNewSession,
  focus,
  onToggleFocus,
  onHidePeek,
}: CompanionBarProps) {
  const setLayout = useCompanionStore((s) => s.setLayout);
  const undo = useCompanionStore((s) => s.undo);
  const redo = useCompanionStore((s) => s.redo);
  const canRedo = useCompanionStore((s) => (s.session?.redoStack.length ?? 0) > 0);
  const advanceTurn = useCompanionStore((s) => s.advanceTurn);
  const cycleDayNight = useCompanionStore((s) => s.cycleDayNight);
  const activePlayer = session.players.find((p) => p.id === session.activePlayerId) ?? null;
  const [logOpen, setLogOpen] = useState(false);
  const DayNightIcon =
    session.dayNight === "night" ? Moon : session.dayNight === "day" ? Sun : SunMoon;
  const layoutChoices = COMPANION_LAYOUT_OPTIONS[session.players.length] ?? ["free"];
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-card/70 px-1.5 py-1 backdrop-blur sm:gap-2 sm:px-3 sm:py-2">
      <Button
        size="sm"
        onClick={onOpenNewSession}
        className="h-8 px-2 text-xs sm:h-9 sm:px-4 sm:text-sm"
        aria-label={i18n._(msg`New game`)}
        title={i18n._(msg`New game`)}
      >
        <span className="hidden sm:inline">
          <Trans>New game</Trans>
        </span>
        <span className="sm:hidden">+</span>
      </Button>

      <SetupMenu session={session} onOpenLog={() => setLogOpen(true)} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
            aria-label={i18n._(msg`Layout: ${COMPANION_LAYOUT_LABELS[session.layout]}`)}
            title={i18n._(msg`Layout: ${COMPANION_LAYOUT_LABELS[session.layout]}`)}
          >
            <LayoutIcon layout={session.layout} className="size-4" />
            <span className="hidden sm:inline">{COMPANION_LAYOUT_LABELS[session.layout]}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>
            <Trans>Layout</Trans>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {layoutChoices.map((option) => (
            <DropdownMenuItem
              key={option}
              onSelect={() => setLayout(option)}
              className={cn("gap-2", option === session.layout && "bg-accent")}
            >
              <LayoutIcon layout={option} className="size-5" />
              {COMPANION_LAYOUT_LABELS[option]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex flex-wrap items-center gap-0.5 sm:gap-2">
        <Button
          size="sm"
          variant={activePlayer ? "default" : "outline"}
          onClick={advanceTurn}
          className="h-8 gap-1 px-1.5 text-xs text-white shadow-sm sm:h-9 sm:px-3 sm:text-sm"
          style={
            activePlayer
              ? { backgroundColor: COMPANION_ACCENT_COLORS[activePlayer.accentKey] }
              : undefined
          }
          aria-label={
            activePlayer
              ? i18n._(msg`Turn ${session.turn} · ${activePlayer.name}`)
              : i18n._(msg`Start turn`)
          }
          title={
            activePlayer
              ? i18n._(msg`Turn ${session.turn} · ${activePlayer.name}`)
              : i18n._(msg`Start turn`)
          }
        >
          <ChevronRight className="size-3.5" />
          <span className="hidden tabular-nums sm:inline">
            {activePlayer
              ? i18n._(msg`T${session.turn} · ${activePlayer.name}`)
              : i18n._(msg`Start`)}
          </span>
          <span className="tabular-nums sm:hidden">
            <Trans>T{session.turn || 1}</Trans>
          </span>
        </Button>

        <Button
          size="icon"
          variant={session.dayNight ? "default" : "ghost"}
          className="size-8"
          onClick={cycleDayNight}
          aria-label={i18n._(msg`Cycle day / night`)}
          title={
            session.dayNight === null
              ? i18n._(msg`Day/Night: off`)
              : session.dayNight === "day"
                ? i18n._(msg`It is day`)
                : i18n._(msg`It is night`)
          }
        >
          <DayNightIcon className="size-4" />
        </Button>

        <TurnTimer />

        <DiceMenu players={session.players} />

        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={undo}
          aria-label={i18n._(msg`Undo last action`)}
          title={i18n._(msg`Undo last action`)}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={redo}
          disabled={!canRedo}
          aria-label={i18n._(msg`Redo`)}
          title={i18n._(msg`Redo`)}
        >
          <Redo2 className="size-4" />
        </Button>

        {onHidePeek && (
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={onHidePeek}
            aria-label={i18n._(msg`Hide controls`)}
            title={i18n._(msg`Hide bar and phase strip`)}
          >
            <EyeOff className="size-4" />
          </Button>
        )}
        <FocusModeButton focus={focus} onToggle={onToggleFocus} />
      </div>

      <GameLog session={session} open={logOpen} onOpenChange={setLogOpen} />
    </div>
  );
}
