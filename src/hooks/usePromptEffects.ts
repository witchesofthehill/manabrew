import { useEffect, useMemo, useState, useCallback } from "react";
import { usePhaseStopStore, getNextStopPhase } from "@/stores/usePhaseStopStore";
import type { Prompt, PromptOutput } from "@/protocol";
import type { AvailableAction } from "@/protocol/prompts/common";
import { passOutput } from "@/components/prompts/internal/playerActions";
import type { GameView } from "@/types/manabrew";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

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
const SMART_COMBAT_SOFT_STEPS = new Set(["declare_attackers", "declare_blockers"]);

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

function hasSmartRelevantAction(actions: AvailableAction[]): boolean {
  return actions.some(
    (action) =>
      action.type === "cast" ||
      action.type === "undoMana" ||
      (action.type === "activateAbility" && !action.isManaAbility),
  );
}

function topStackObject(gameView: GameView) {
  return gameView.stack[gameView.stack.length - 1] ?? null;
}

function hasTargetedManaSourceAction(
  gameView: GameView,
  actions: AvailableAction[],
  myPlayerId: string,
): boolean {
  const top = topStackObject(gameView);
  if (!top) return false;
  const localBattlefieldCardIds = new Set(
    gameView.battlefield.filter((card) => card.controllerId === myPlayerId).map((card) => card.id),
  );
  const targetedLocalCardIds = new Set(
    top.targets
      .filter((target) => target.kind === "card" && localBattlefieldCardIds.has(target.id))
      .map((target) => target.id),
  );
  if (targetedLocalCardIds.size === 0) return false;
  return actions.some(
    (action) =>
      action.type === "activateAbility" &&
      action.isManaAbility &&
      targetedLocalCardIds.has(action.cardId),
  );
}

function isSmartSoftWindow(gameView: GameView, myPlayerId: string): boolean {
  const top = topStackObject(gameView);
  if (top) return top.controllerId !== myPlayerId;
  if (
    gameView.activePlayerId === myPlayerId &&
    (gameView.step === "main1" || gameView.step === "main2")
  ) {
    return true;
  }
  return SMART_COMBAT_SOFT_STEPS.has(gameView.step) || gameView.step === "end";
}

function promptKey(currentPrompt: Prompt, gameView: GameView): string {
  const id = (currentPrompt as { promptId?: unknown }).promptId;
  if (id !== undefined && id !== null) return `${gameView.gameId}:${String(id)}`;
  return [
    gameView.gameId,
    gameView.turn,
    gameView.step,
    gameView.priorityPlayerId,
    gameView.stack.length,
    currentPrompt.input.type,
  ].join(":");
}

interface SmartHardStop {
  opponentId: string | null;
  phaseId: string;
}

function getSmartHardStop(
  gameView: GameView,
  myPlayerId: string,
  smartSelfStops: Set<string>,
  smartOpponentStops: Map<string, Set<string>>,
): SmartHardStop | null {
  if (gameView.activePlayerId === myPlayerId) {
    return smartSelfStops.has(gameView.step) ? { opponentId: null, phaseId: gameView.step } : null;
  }
  return (smartOpponentStops.get(gameView.activePlayerId) ?? new Set()).has(gameView.step)
    ? { opponentId: gameView.activePlayerId, phaseId: gameView.step }
    : null;
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

function computeSmartAutoPassPlan(
  currentPrompt: Prompt | null,
  gameView: GameView | null,
  isWaitingForResponse: boolean,
  fullControlPriority: boolean,
  hardStopPromptKeys: Set<string>,
  smartSelfStops: Set<string>,
  smartOpponentStops: Map<string, Set<string>>,
  myPlayerId: string,
): AutoPassPlan {
  if (!currentPrompt || !gameView || isWaitingForResponse) return { action: "none" };
  if (currentPrompt.input.type !== "chooseAction") return { action: "none" };
  const key = promptKey(currentPrompt, gameView);
  if (fullControlPriority || hardStopPromptKeys.has(key)) return { action: "none" };
  if (getSmartHardStop(gameView, myPlayerId, smartSelfStops, smartOpponentStops)) {
    return { action: "none" };
  }
  const actions = currentPrompt.input.actions;
  if (hasTargetedManaSourceAction(gameView, actions, myPlayerId)) return { action: "none" };
  if (isSmartSoftWindow(gameView, myPlayerId) && hasSmartRelevantAction(actions)) {
    return { action: "none" };
  }
  return { action: "schedulePass", untilPhase: null };
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
  const smartSelfStops = usePhaseStopStore((s) => s.smartSelfStops);
  const smartOpponentStops = usePhaseStopStore((s) => s.smartOpponentStops);
  const triggeredSmartStopPromptKeys = usePhaseStopStore((s) => s.triggeredSmartStopPromptKeys);
  const experimentalSmartPriority = usePreferencesStore((s) => s.experimentalSmartPriority);
  const fullControlPriority = usePreferencesStore((s) => s.fullControlPriority);

  const activeSmartHardStop = useMemo(() => {
    if (
      !experimentalSmartPriority ||
      !currentPrompt ||
      !gameView ||
      currentPrompt.input.type !== "chooseAction"
    ) {
      return null;
    }
    const stop = getSmartHardStop(gameView, myPlayerId, smartSelfStops, smartOpponentStops);
    if (!stop) return null;
    return { ...stop, key: promptKey(currentPrompt, gameView) };
  }, [
    experimentalSmartPriority,
    currentPrompt,
    gameView,
    myPlayerId,
    smartSelfStops,
    smartOpponentStops,
  ]);

  const autoPassPlan = useMemo(() => {
    if (experimentalSmartPriority) {
      return computeSmartAutoPassPlan(
        currentPrompt,
        gameView,
        isWaitingForResponse,
        fullControlPriority,
        triggeredSmartStopPromptKeys,
        smartSelfStops,
        smartOpponentStops,
        myPlayerId,
      );
    }
    return computeAutoPassPlan(
      currentPrompt,
      gameView,
      isWaitingForResponse,
      passUntilTurn,
      passUntilPhase,
      turn,
      stackLength,
      myPlayerId,
    );
  }, [
    currentPrompt,
    gameView,
    isWaitingForResponse,
    experimentalSmartPriority,
    fullControlPriority,
    triggeredSmartStopPromptKeys,
    passUntilTurn,
    passUntilPhase,
    turn,
    stackLength,
    myPlayerId,
    smartSelfStops,
    smartOpponentStops,
  ]);

  const unifiedPass = useCallback(() => {
    if (!currentPrompt || !gameView || isWaitingForResponse) return;

    if (experimentalSmartPriority) {
      pass(null);
      return;
    }

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
  }, [
    currentPrompt,
    gameView,
    isWaitingForResponse,
    experimentalSmartPriority,
    pass,
    myPlayerId,
    turn,
  ]);

  function activatePassUntilEot() {
    unifiedPass();
  }

  const [spellStackModalOpen, setSpellStackModalOpen] = useState(false);

  useEffect(() => {
    if (!activeSmartHardStop) return;
    usePhaseStopStore.getState().markSmartStopPromptTriggered(activeSmartHardStop.key);
    usePhaseStopStore
      .getState()
      .consumeSmartStop(activeSmartHardStop.opponentId, activeSmartHardStop.phaseId);
  }, [activeSmartHardStop]);

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
