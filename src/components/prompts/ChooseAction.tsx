import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getPromptActionButtonStyle,
  usePromptActionColors,
} from "@/components/prompts/internal/promptActionTheme";
import { useAutopass } from "@/components/prompts/internal/useAutopass";
import { KeyChip } from "@/components/prompts/internal/KeyChip";
import { comboSymbols, normalizeCombo, type KeyCombo } from "@/lib/keybindings";
import { useGameStore } from "@/stores/useGameStore";
import { useKeybindingsStore, resolveCombo } from "@/stores/useKeybindingsStore";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { cn } from "@/lib/utils";
import { AUTOPASS_DELAY_MIN_MS, AUTOPASS_DELAY_MAX_MS } from "@/components/game/game.constants";
import type { ChooseActionProps } from "./internal/types";

function AutopassFill({ onDone }: { onDone: () => void }) {
  const fillRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    const ms = Math.round(
      AUTOPASS_DELAY_MIN_MS + Math.random() * (AUTOPASS_DELAY_MAX_MS - AUTOPASS_DELAY_MIN_MS),
    );
    fillRef.current?.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
      duration: ms,
      easing: "linear",
      fill: "forwards",
    });
    const timer = setTimeout(() => onDoneRef.current(), ms);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      ref={fillRef}
      className="absolute inset-0 origin-left bg-white/25"
      style={{ transform: "scaleX(0)" }}
    />
  );
}

function useComboModifiersHeld(combo: KeyCombo | null): boolean {
  const [held, setHeld] = useState(false);
  const c = combo ? normalizeCombo(combo) : undefined;
  const modsKey = c
    ? [c.shift && "Shift", c.ctrl && "Control", c.alt && "Alt", c.meta && "Meta"]
        .filter(Boolean)
        .join("+")
    : "";
  useEffect(() => {
    if (!modsKey) return;
    const required = modsKey.split("+");
    const update = (e: KeyboardEvent | PointerEvent) =>
      setHeld(required.every((m) => e.getModifierState(m)));
    const reset = () => setHeld(false);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerdown", update);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerdown", update);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [modsKey]);
  return modsKey ? held : false;
}

export function ChooseAction({
  isWaitingForResponse,
  onPassPriority,
  onPassEndTurn,
  isMyTurn,
}: ChooseActionProps) {
  const promptActionColors = usePromptActionColors();
  const passActionStyle = getPromptActionButtonStyle(promptActionColors.passAction);
  const minimal = useIsMobileGame();
  const { counting } = useAutopass();
  const stackEmpty = useGameStore((s) => (s.gameView?.stack?.length ?? 0) === 0);
  const keyOverrides = useKeybindingsStore((s) => s.overrides);

  const passCombo = resolveCombo("pass-priority", keyOverrides);
  const endTurnCombo = resolveCombo("pass-end-of-turn", keyOverrides);

  const endTurnLabel = stackEmpty ? (isMyTurn ? "END TURN" : "NEXT TURN") : "RESOLVE STACK";
  const endTurnTitle = stackEmpty
    ? isMyTurn
      ? "Pass until end of turn"
      : "Pass until the next turn"
    : "Pass until the stack is empty";
  const endTurnHeld = useComboModifiersHeld(endTurnCombo);
  const morphed = endTurnHeld;
  const label = morphed ? endTurnLabel : counting ? "PASSING" : "PASS";
  const onClick = morphed ? onPassEndTurn : onPassPriority;
  const title = morphed ? endTurnTitle : undefined;
  const chip = morphed ? endTurnCombo : passCombo;

  if (minimal) {
    return (
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="relative h-10 overflow-hidden rounded-full px-4 text-xs font-black tracking-[0.12em] !border-0 !text-white transition-[filter,box-shadow] hover:brightness-105"
          onClick={onClick}
          disabled={isWaitingForResponse}
          style={passActionStyle}
          title={title}
        >
          {counting && <AutopassFill onDone={onPassPriority} />}
          <span className="relative">{label}</span>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-10 rounded-full px-3 text-[10px] font-black tracking-[0.12em]"
          onClick={onPassEndTurn}
          disabled={isWaitingForResponse}
        >
          {endTurnLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col py-0.5">
      <div
        className={cn(
          "flex h-9 w-full overflow-hidden rounded-lg ring-1 ring-inset ring-white/20",
          isWaitingForResponse && "pointer-events-none opacity-60",
        )}
        style={{ ...passActionStyle, boxShadow: "none" }}
      >
        <button
          type="button"
          className={cn(
            "relative flex h-full flex-1 items-center justify-center gap-1.5 overflow-hidden text-xs font-black tracking-[0.14em] transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none",
            morphed && "bg-white/15",
          )}
          onClick={onClick}
          disabled={isWaitingForResponse}
          title={title}
        >
          {counting && !morphed && <AutopassFill onDone={onPassPriority} />}
          <span className="relative flex items-center gap-1.5">
            {label}
            {chip && <KeyChip combo={chip} />}
          </span>
        </button>
        {!morphed && (
          <button
            type="button"
            className="flex h-full items-center justify-center border-l border-white/20 bg-black/15 px-3.5 text-[11px] font-bold tracking-[0.14em] text-white/75 transition-[color,background-color] hover:bg-black/30 hover:text-white focus-visible:bg-black/30 focus-visible:text-white focus-visible:outline-none"
            onClick={onPassEndTurn}
            disabled={isWaitingForResponse}
            title={endTurnCombo ? `${endTurnTitle} (${comboSymbols(endTurnCombo)})` : endTurnTitle}
          >
            {endTurnLabel}
          </button>
        )}
      </div>
    </div>
  );
}
