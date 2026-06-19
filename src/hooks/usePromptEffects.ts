import { useEffect, useMemo, useState, useCallback } from "react";
import { usePhaseStopStore, getNextStopPhase } from "@/stores/usePhaseStopStore";
import type { Prompt, PromptOutput } from "@/protocol";
import { passOutput } from "@/components/prompts/internal/playerActions";
import type { GameView } from "@/types/manabrew";

interface UsePromptEffectsOptions {
  currentPrompt: Prompt | null;
  gameView: GameView | null;
  isWaitingForResponse: boolean;
  respond: (output: PromptOutput["output"]) => void;
  myPlayerId: string;
  turn: number;
  stackLength: number;
}

const AUTO_PASS_DELAY_MIN_MS = 250;
const AUTO_PASS_DELAY_MAX_MS = 650;

function getAutoPassDelayMs(): number {
  return Math.floor(
    AUTO_PASS_DELAY_MIN_MS + Math.random() * (AUTO_PASS_DELAY_MAX_MS - AUTO_PASS_DELAY_MIN_MS + 1),
  );
}

const ACTIVE_COMBAT_PRIORITY_STEPS = new Set([
  "declare_attackers",
  "declare_blockers",
  "first_strike_damage",
  "combat_damage",
  "end_combat",
]);

const MANDATORY_COMBAT_STOPS = new Set(["declare_blockers"]);

function hasActiveCombatAfterAttackers(gameView: GameView): boolean {
  return (
    ACTIVE_COMBAT_PRIORITY_STEPS.has(gameView.step) &&
    gameView.battlefield.some((card) => card.isAttacking === true)
  );
}

function hasNonPassPriorityAction(prompt: Prompt): boolean {
  if (prompt.input.type !== "chooseAction") return false;
  // Every entry in `actions` is a real, non-pass action (pass lives in the
  // response type, never in the list).
  return prompt.input.actions.length > 0;
}

type AutoPassPlan =
  | { action: "none" }
  | { action: "clearPassUntil" }
  | { action: "schedulePass"; untilPhase: string | null };

interface AutoPassInputs {
  currentPrompt: Prompt;
  gameView: GameView;
  passUntilTurn: number | null;
  passUntilPhase: string | null;
  turn: number;
  stackLength: number;
  myPlayerId: string;
}

function stopForActiveCombatAfterAttackers(inputs: AutoPassInputs): AutoPassPlan | null {
  const { currentPrompt, stackLength, passUntilTurn } = inputs;
  if (
    currentPrompt.input.type !== "chooseAction" ||
    stackLength !== 0 ||
    !hasActiveCombatAfterAttackers(inputs.gameView) ||
    !hasNonPassPriorityAction(currentPrompt)
  ) {
    return null;
  }
  return passUntilTurn !== null ? { action: "clearPassUntil" } : { action: "none" };
}

function stopForMandatoryCombatStop(inputs: AutoPassInputs): AutoPassPlan | null {
  const { currentPrompt, stackLength, passUntilTurn, myPlayerId } = inputs;
  if (currentPrompt.input.type !== "chooseAction" || stackLength !== 0) return null;
  const gv = inputs.gameView;
  if (gv.activePlayerId === myPlayerId) return null;
  if (!MANDATORY_COMBAT_STOPS.has(gv.step)) return null;
  return passUntilTurn !== null ? { action: "clearPassUntil" } : { action: "none" };
}

function planWhilePassingUntilPhase(inputs: AutoPassInputs): AutoPassPlan {
  const { currentPrompt, gameView, passUntilTurn, passUntilPhase, turn, stackLength, myPlayerId } =
    inputs;

  if (passUntilTurn !== null && turn > passUntilTurn) return { action: "clearPassUntil" };
  if (currentPrompt.input.type === "chooseAction" && stackLength > 0) {
    return { action: "clearPassUntil" };
  }
  if (passUntilPhase && gameView.step === passUntilPhase && stackLength === 0) {
    return { action: "clearPassUntil" };
  }

  if (currentPrompt.input.type === "chooseAction" && stackLength === 0) {
    const gv = gameView;
    const isMyTurn = gv.activePlayerId === myPlayerId;
    const store = usePhaseStopStore.getState();
    const stops = isMyTurn ? store.selfStops : store.getOpponentStops(gv.activePlayerId);
    if (stops.has(gv.step)) return { action: "clearPassUntil" };
  }

  if (
    currentPrompt.input.type === "chooseAction" ||
    currentPrompt.input.type === "chooseAttackers"
  ) {
    return { action: "schedulePass", untilPhase: passUntilPhase };
  }

  return { action: "clearPassUntil" };
}

function planForIdlePhaseSkip(inputs: AutoPassInputs): AutoPassPlan {
  const { currentPrompt, stackLength, myPlayerId } = inputs;
  if (currentPrompt.input.type !== "chooseAction" || stackLength !== 0) {
    return { action: "none" };
  }
  const gv = inputs.gameView;
  const isMyTurn = gv.activePlayerId === myPlayerId;
  const store = usePhaseStopStore.getState();
  const stops = isMyTurn ? store.selfStops : store.getOpponentStops(gv.activePlayerId);
  if (stops.has(gv.step)) return { action: "none" };
  const nextStop = getNextStopPhase(gv.step, stops);
  return { action: "schedulePass", untilPhase: nextStop };
}

function computeAutoPassPlan(
  currentPrompt: Prompt | null,
  gameView: GameView | null,
  isWaitingForResponse: boolean,
  passUntilTurn: number | null,
  passUntilPhase: string | null,
  turn: number,
  stackLength: number,
  myPlayerId: string,
): AutoPassPlan {
  if (!currentPrompt || !gameView || isWaitingForResponse) return { action: "none" };
  const inputs: AutoPassInputs = {
    currentPrompt,
    gameView,
    passUntilTurn,
    passUntilPhase,
    turn,
    stackLength,
    myPlayerId,
  };
  return (
    stopForActiveCombatAfterAttackers(inputs) ??
    stopForMandatoryCombatStop(inputs) ??
    (passUntilTurn !== null ? planWhilePassingUntilPhase(inputs) : planForIdlePhaseSkip(inputs))
  );
}

export function usePromptEffects({
  currentPrompt,
  gameView,
  isWaitingForResponse,
  respond,
  myPlayerId,
  turn,
  stackLength,
}: UsePromptEffectsOptions) {
  const pass = useCallback(
    (untilPhase: string | null) => {
      const out = passOutput(currentPrompt, untilPhase);
      if (out) respond(out);
    },
    [currentPrompt, respond],
  );
  const passUntilPhase = usePhaseStopStore((s) => s.passUntilPhase);
  const passUntilTurn = usePhaseStopStore((s) => s.passUntilTurn);

  const autoPassPlan = useMemo(
    () =>
      computeAutoPassPlan(
        currentPrompt,
        gameView,
        isWaitingForResponse,
        passUntilTurn,
        passUntilPhase,
        turn,
        stackLength,
        myPlayerId,
      ),
    [
      currentPrompt,
      gameView,
      isWaitingForResponse,
      passUntilTurn,
      passUntilPhase,
      turn,
      stackLength,
      myPlayerId,
    ],
  );

  const unifiedPass = useCallback(() => {
    if (!currentPrompt || !gameView || isWaitingForResponse) return;

    const gv = gameView;
    const hasStack = (gv.stack?.length ?? 0) > 0;

    if (hasStack) {
      pass(null);
      return;
    }

    const isMyTurn = gv.activePlayerId === myPlayerId;
    const store = usePhaseStopStore.getState();
    const stops = isMyTurn ? store.selfStops : store.getOpponentStops(gv.activePlayerId);

    const nextStop = getNextStopPhase(gv.step, stops);

    usePhaseStopStore.getState().setPassUntil(nextStop, turn);

    pass(nextStop);
  }, [currentPrompt, gameView, isWaitingForResponse, pass, myPlayerId, turn]);

  function activatePassUntilEot() {
    unifiedPass();
  }

  const [spellStackModalOpen, setSpellStackModalOpen] = useState(false);

  useEffect(() => {
    if (autoPassPlan.action === "clearPassUntil") {
      usePhaseStopStore.getState().clearPassUntil();
      return;
    }
    if (autoPassPlan.action === "schedulePass") {
      const untilPhase = autoPassPlan.untilPhase;
      const timer = setTimeout(() => pass(untilPhase), getAutoPassDelayMs());
      return () => clearTimeout(timer);
    }
  }, [autoPassPlan, pass]);

  const isAutoPassing = autoPassPlan.action === "schedulePass";

  return {
    isAutoPassing,
    isPassingUntilEot: passUntilTurn !== null,
    unifiedPass,
    activatePassUntilEot,
    spellStackModalOpen,
    setSpellStackModalOpen,
  };
}
