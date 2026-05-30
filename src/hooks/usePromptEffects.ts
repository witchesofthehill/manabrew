import { useEffect, useState, useCallback } from "react";
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

export function usePromptEffects({
  currentPrompt,
  isWaitingForResponse,
  passPriority,
  myPlayerId,
  turn,
  stackLength,
}: UsePromptEffectsOptions) {
  const promptType = currentPrompt?.type;
  const [isAutoPassing, setIsAutoPassing] = useState(false);

  // Phase-stop auto-pass state lives in the store so non-pass actions can clear it
  const passUntilPhase = usePhaseStopStore((s) => s.passUntilPhase);
  const passUntilTurn = usePhaseStopStore((s) => s.passUntilTurn);

  /**
   * Unified pass action. Context-aware:
   * - Clean priority (no stack): auto-pass until next enabled stop phase
   * - In response (stack > 0): just pass priority once
   */
  const unifiedPass = useCallback(() => {
    if (!currentPrompt || isWaitingForResponse) return;

    const gv = currentPrompt.gameView;
    const hasStack = (gv.stack?.length ?? 0) > 0;

    if (hasStack) {
      // Responding to something — atomic single pass
      passPriority(null);
      return;
    }

    // Clean priority — determine which stop set applies
    const isMyTurn = gv.activePlayerId === myPlayerId;
    const store = usePhaseStopStore.getState();
    const stops = isMyTurn ? store.selfStops : store.getOpponentStops(gv.activePlayerId);

    const nextStop = getNextStopPhase(gv.step, stops);

    // Set frontend auto-pass state (fallback for any prompts the engine
    // still sends despite the pass-until declaration)
    usePhaseStopStore.getState().setPassUntil(nextStop, turn);

    // Send pass with until-phase to engine so it can fast-forward
    passPriority(nextStop);
  }, [currentPrompt, isWaitingForResponse, passPriority, myPlayerId, turn]);

  // F6: just triggers the same unified pass
  function activatePassUntilEot() {
    unifiedPass();
  }

  // Library peek modal state
  const [libraryPeekModal, setLibraryPeekModal] = useState<LibraryPeekState | null>(null);

  // Zone target selector state
  const [zoneTargetSelector, setZoneTargetSelector] = useState<ZoneTargetState | null>(null);

  // Spell stack modal
  const [spellStackModalOpen, setSpellStackModalOpen] = useState(false);

  // Auto-pass logic
  useEffect(() => {
    setIsAutoPassing(false);
    if (!currentPrompt || isWaitingForResponse) return;

    if (
      currentPrompt.type === PromptType.ChooseAction &&
      stackLength === 0 &&
      hasActiveCombatAfterAttackers(currentPrompt) &&
      hasNonPassPriorityAction(currentPrompt)
    ) {
      if (passUntilTurn !== null) {
        usePhaseStopStore.getState().clearPassUntil();
      }
      return;
    }

    const MANDATORY_COMBAT_STOPS = new Set(["declare_blockers"]);

    if (currentPrompt.type === PromptType.ChooseAction && stackLength === 0) {
      const gv = currentPrompt.gameView;
      const isMyTurn = gv.activePlayerId === myPlayerId;
      if (!isMyTurn && MANDATORY_COMBAT_STOPS.has(gv.step)) {
        // Cancel any active pass-until and stop here
        if (passUntilTurn !== null) {
          usePhaseStopStore.getState().clearPassUntil();
        }
        return; // don't auto-pass — let the player act
      }
    }

    // ── Phase-stop auto-pass ──
    if (passUntilTurn !== null) {
      // Turn advanced — cancel
      if (turn > passUntilTurn) {
        usePhaseStopStore.getState().clearPassUntil();
        return;
      }

      // Stack appeared — cancel (player is responding to something)
      if (currentPrompt.type === PromptType.ChooseAction && stackLength > 0) {
        usePhaseStopStore.getState().clearPassUntil();
        return;
      }

      // Reached target phase — stop
      if (passUntilPhase && currentPrompt.gameView.step === passUntilPhase && stackLength === 0) {
        usePhaseStopStore.getState().clearPassUntil();
        return;
      }

      // Current phase is a stop — cancel auto-pass so the player gets
      // control (e.g. back on M1 after a spell resolved)
      if (currentPrompt.type === PromptType.ChooseAction && stackLength === 0) {
        const gv = currentPrompt.gameView;
        const isMyTurn = gv.activePlayerId === myPlayerId;
        const store = usePhaseStopStore.getState();
        const stops = isMyTurn ? store.selfStops : store.getOpponentStops(gv.activePlayerId);
        if (stops.has(gv.step)) {
          usePhaseStopStore.getState().clearPassUntil();
          return;
        }
      }

      // Still auto-passing — relay until-phase to engine
      if (
        currentPrompt.type === PromptType.ChooseAction ||
        currentPrompt.type === PromptType.ChooseAttackers
      ) {
        setIsAutoPassing(true);
        const timer = setTimeout(() => passPriority(passUntilPhase), getAutoPassDelayMs());
        return () => clearTimeout(timer);
      }

      // Unexpected prompt type — cancel
      usePhaseStopStore.getState().clearPassUntil();
      return;
    }

    // ── Phase-stop skip: if current phase isn't a stop, auto-pass ──

    if (currentPrompt.type === PromptType.ChooseAction && stackLength === 0) {
      const gv = currentPrompt.gameView;
      const isMyTurn = gv.activePlayerId === myPlayerId;

      const store = usePhaseStopStore.getState();
      const stops = isMyTurn ? store.selfStops : store.getOpponentStops(gv.activePlayerId);

      if (!stops.has(gv.step)) {
        const nextStop = getNextStopPhase(gv.step, stops);
        setIsAutoPassing(true);
        const timer = setTimeout(() => passPriority(nextStop), getAutoPassDelayMs());
        return () => clearTimeout(timer);
      }
    }
  }, [
    currentPrompt,
    isWaitingForResponse,
    passPriority,
    passUntilTurn,
    passUntilPhase,
    turn,
    stackLength,
    myPlayerId,
  ]);

  useEffect(() => {
    if (promptType === PromptType.ChooseTargetCardFromZone && currentPrompt) {
      const zone = currentPrompt.zone;
      const validCardIds = currentPrompt.validCardIds || [];
      const zoneCards = currentPrompt.zoneCards || [];

      if (zone && zone !== "Battlefield" && zoneCards.length > 0) {
        const zoneNames: Record<string, string> = {
          Graveyard: "Graveyard",
          Exile: "Exile",
          Hand: "Hand",
        };
        const title = `Choose from ${zoneNames[zone] || zone}`;
        setZoneTargetSelector({ title, cards: zoneCards, validCardIds });
      } else {
        setZoneTargetSelector(null);
      }
    } else {
      setZoneTargetSelector(null);
    }
  }, [promptType, currentPrompt]);

  // Auto-open spell-stack modal for counter-targeting prompts
  useEffect(() => {
    setSpellStackModalOpen(promptType === PromptType.ChooseTargetSpell);
  }, [promptType]);

  return {
    isAutoPassing,
    isPassingUntilEot: passUntilTurn !== null,
    unifiedPass,
    activatePassUntilEot,
    libraryPeekModal,
    setLibraryPeekModal,
    zoneTargetSelector,
    setZoneTargetSelector,
    spellStackModalOpen,
    setSpellStackModalOpen,
  };
}
