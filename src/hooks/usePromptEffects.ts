import { useEffect, useMemo, useState, useCallback } from "react";
import { usePhaseStopStore, getNextStopPhase } from "@/stores/usePhaseStopStore";
import type { AgentPrompt } from "@/stores/useGameStore";
import type { LibraryPeekMode } from "@/components/game/modals";
import type { GameCard } from "@/types/manabrew";
import { PromptType } from "@/types/promptType";

interface UsePromptEffectsOptions {
  currentPrompt: AgentPrompt | null;
  isWaitingForResponse: boolean;
  passPriority: (untilPhase?: string | null) => void;
  myPlayerId: string;
  turn: number;
  stackLength: number;
}

interface LibraryPeekState {
  mode: LibraryPeekMode;
  cards: GameCard[];
  numToTake?: number;
  optional?: boolean;
}

interface ZoneTargetState {
  title: string;
  cards: GameCard[];
  validCardIds: string[];
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

function hasActiveCombatAfterAttackers(prompt: AgentPrompt): boolean {
  return (
    ACTIVE_COMBAT_PRIORITY_STEPS.has(prompt.gameView.step) &&
    prompt.gameView.battlefield.some((card) => card.isAttacking === true)
  );
}

function hasNonPassPriorityAction(prompt: AgentPrompt): boolean {
  return (
    (prompt.playableCardIds ?? []).length > 0 ||
    (prompt.activatableAbilityIds ?? []).length > 0 ||
    (prompt.tappableLandIds ?? []).length > 0 ||
    (prompt.manaAbilityOptions ?? []).length > 0 ||
    (prompt.untappableLandIds ?? []).length > 0
  );
}

type AutoPassPlan =
  | { action: "none" }
  | { action: "clearPassUntil" }
  | { action: "schedulePass"; untilPhase: string | null };

interface AutoPassInputs {
  currentPrompt: AgentPrompt;
  passUntilTurn: number | null;
  passUntilPhase: string | null;
  turn: number;
  stackLength: number;
  myPlayerId: string;
}

function stopForActiveCombatAfterAttackers(inputs: AutoPassInputs): AutoPassPlan | null {
  const { currentPrompt, stackLength, passUntilTurn } = inputs;
  if (
    currentPrompt.type !== PromptType.ChooseAction ||
    stackLength !== 0 ||
    !hasActiveCombatAfterAttackers(currentPrompt) ||
    !hasNonPassPriorityAction(currentPrompt)
  ) {
    return null;
  }
  return passUntilTurn !== null ? { action: "clearPassUntil" } : { action: "none" };
}

function stopForMandatoryCombatStop(inputs: AutoPassInputs): AutoPassPlan | null {
  const { currentPrompt, stackLength, passUntilTurn, myPlayerId } = inputs;
  if (currentPrompt.type !== PromptType.ChooseAction || stackLength !== 0) return null;
  const gv = currentPrompt.gameView;
  if (gv.activePlayerId === myPlayerId) return null;
  if (!MANDATORY_COMBAT_STOPS.has(gv.step)) return null;
  return passUntilTurn !== null ? { action: "clearPassUntil" } : { action: "none" };
}

function planWhilePassingUntilPhase(inputs: AutoPassInputs): AutoPassPlan {
  const { currentPrompt, passUntilTurn, passUntilPhase, turn, stackLength, myPlayerId } = inputs;

  if (passUntilTurn !== null && turn > passUntilTurn) return { action: "clearPassUntil" };
  if (currentPrompt.type === PromptType.ChooseAction && stackLength > 0) {
    return { action: "clearPassUntil" };
  }
  if (passUntilPhase && currentPrompt.gameView.step === passUntilPhase && stackLength === 0) {
    return { action: "clearPassUntil" };
  }

  if (currentPrompt.type === PromptType.ChooseAction && stackLength === 0) {
    const gv = currentPrompt.gameView;
    const isMyTurn = gv.activePlayerId === myPlayerId;
    const store = usePhaseStopStore.getState();
    const stops = isMyTurn ? store.selfStops : store.getOpponentStops(gv.activePlayerId);
    if (stops.has(gv.step)) return { action: "clearPassUntil" };
  }

  if (
    currentPrompt.type === PromptType.ChooseAction ||
    currentPrompt.type === PromptType.ChooseAttackers
  ) {
    return { action: "schedulePass", untilPhase: passUntilPhase };
  }

  return { action: "clearPassUntil" };
}

function planForIdlePhaseSkip(inputs: AutoPassInputs): AutoPassPlan {
  const { currentPrompt, stackLength, myPlayerId } = inputs;
  if (currentPrompt.type !== PromptType.ChooseAction || stackLength !== 0) {
    return { action: "none" };
  }
  const gv = currentPrompt.gameView;
  const isMyTurn = gv.activePlayerId === myPlayerId;
  const store = usePhaseStopStore.getState();
  const stops = isMyTurn ? store.selfStops : store.getOpponentStops(gv.activePlayerId);
  if (stops.has(gv.step)) return { action: "none" };
  const nextStop = getNextStopPhase(gv.step, stops);
  return { action: "schedulePass", untilPhase: nextStop };
}

function computeAutoPassPlan(
  currentPrompt: AgentPrompt | null,
  isWaitingForResponse: boolean,
  passUntilTurn: number | null,
  passUntilPhase: string | null,
  turn: number,
  stackLength: number,
  myPlayerId: string,
): AutoPassPlan {
  if (!currentPrompt || isWaitingForResponse) return { action: "none" };
  const inputs: AutoPassInputs = {
    currentPrompt,
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

function computeZoneTarget(currentPrompt: AgentPrompt | null): ZoneTargetState | null {
  if (currentPrompt?.type !== PromptType.ChooseTargetCardFromZone) return null;
  const zone = currentPrompt.zone;
  const validCardIds = currentPrompt.validCardIds || [];
  const zoneCards = currentPrompt.zoneCards || [];
  if (!zone || zone === "Battlefield" || zoneCards.length === 0) return null;
  const zoneNames: Record<string, string> = {
    Graveyard: "Graveyard",
    Exile: "Exile",
    Hand: "Hand",
  };
  return {
    title: `Choose from ${zoneNames[zone] || zone}`,
    cards: zoneCards,
    validCardIds,
  };
}

export function usePromptEffects({
  currentPrompt,
  isWaitingForResponse,
  passPriority,
  myPlayerId,
  turn,
  stackLength,
}: UsePromptEffectsOptions) {
  const passUntilPhase = usePhaseStopStore((s) => s.passUntilPhase);
  const passUntilTurn = usePhaseStopStore((s) => s.passUntilTurn);

  const autoPassPlan = useMemo(
    () =>
      computeAutoPassPlan(
        currentPrompt,
        isWaitingForResponse,
        passUntilTurn,
        passUntilPhase,
        turn,
        stackLength,
        myPlayerId,
      ),
    [
      currentPrompt,
      isWaitingForResponse,
      passUntilTurn,
      passUntilPhase,
      turn,
      stackLength,
      myPlayerId,
    ],
  );

  const unifiedPass = useCallback(() => {
    if (!currentPrompt || isWaitingForResponse) return;

    const gv = currentPrompt.gameView;
    const hasStack = (gv.stack?.length ?? 0) > 0;

    if (hasStack) {
      passPriority(null);
      return;
    }

    const isMyTurn = gv.activePlayerId === myPlayerId;
    const store = usePhaseStopStore.getState();
    const stops = isMyTurn ? store.selfStops : store.getOpponentStops(gv.activePlayerId);

    const nextStop = getNextStopPhase(gv.step, stops);

    usePhaseStopStore.getState().setPassUntil(nextStop, turn);

    passPriority(nextStop);
  }, [currentPrompt, isWaitingForResponse, passPriority, myPlayerId, turn]);

  function activatePassUntilEot() {
    unifiedPass();
  }

  const [libraryPeekModal, setLibraryPeekModal] = useState<LibraryPeekState | null>(null);

  const zoneTargetFromPrompt = useMemo(() => computeZoneTarget(currentPrompt), [currentPrompt]);
  const [zoneTargetDismissedPrompt, setZoneTargetDismissedPrompt] = useState<AgentPrompt | null>(
    null,
  );
  const zoneTargetSelector =
    zoneTargetDismissedPrompt === currentPrompt ? null : zoneTargetFromPrompt;
  const dismissZoneTarget = useCallback(() => {
    setZoneTargetDismissedPrompt(currentPrompt);
  }, [currentPrompt]);
  const reopenZoneTarget = useCallback(() => {
    setZoneTargetDismissedPrompt(null);
  }, []);

  const [spellStackModalOpen, setSpellStackModalOpen] = useState(false);

  useEffect(() => {
    if (autoPassPlan.action === "clearPassUntil") {
      usePhaseStopStore.getState().clearPassUntil();
      return;
    }
    if (autoPassPlan.action === "schedulePass") {
      const untilPhase = autoPassPlan.untilPhase;
      const timer = setTimeout(() => passPriority(untilPhase), getAutoPassDelayMs());
      return () => clearTimeout(timer);
    }
  }, [autoPassPlan, passPriority]);

  const isAutoPassing = autoPassPlan.action === "schedulePass";

  return {
    isAutoPassing,
    isPassingUntilEot: passUntilTurn !== null,
    unifiedPass,
    activatePassUntilEot,
    libraryPeekModal,
    setLibraryPeekModal,
    zoneTargetSelector,
    dismissZoneTarget,
    reopenZoneTarget,
    spellStackModalOpen,
    setSpellStackModalOpen,
  };
}
