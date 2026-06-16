import { useState } from "react";
import type { GameCard } from "@/types/manabrew";
import type { Prompt } from "@/protocol";
import type { PromptOutput } from "@/protocol";
import { declareAttackersOutput } from "@/components/prompts/internal/playerActions";

export interface CombatAssignment {
  blockerId: string;
  attackerId: string;
}

interface UseCombatStateOptions {
  promptType: string | undefined;
  targetCard: (cardId: string) => void;
  targetPlayer: (playerId: string) => void;
  respond: (output: PromptOutput) => void;
  currentPrompt: Prompt | null;
  /** Board-target candidate ids for the active `chooseBoardTargets` prompt,
   *  partitioned from `gameView` (battlefield cards / players). */
  targetableCardIds: string[];
  targetablePlayerIds: string[];
  /** True once the engine's gameView carries the locked-in blocks. Used to
   *  hand local pending blocks over to the engine without a one-frame gap. */
  engineHasBlocks: boolean;
}

export function useCombatState({
  promptType,
  targetCard,
  targetPlayer,
  respond,
  currentPrompt,
  targetableCardIds,
  targetablePlayerIds,
  engineHasBlocks,
}: UseCombatStateOptions) {
  const [pendingAttackers, setPendingAttackers] = useState<string[]>([]);
  const [pendingAttacker, setPendingAttacker] = useState<string | null>(null);
  const [pendingBlocker, setPendingBlocker] = useState<string | null>(null);
  const [attackDefenderId, setAttackDefenderId] = useState<string | null>(null);
  const [blockAssignments, setBlockAssignments] = useState<CombatAssignment[]>([]);
  const [damageOrder, setDamageOrder] = useState<string[]>([]);

  // Reset transient combat selections whenever the prompt type changes. Block
  // assignments are NOT cleared on leaving chooseBlockers: they keep driving
  // the spatial staging until the engine echoes the locked-in blocks (see the
  // engine-handoff below), so the blocker doesn't snap home for a frame.
  const [prevPromptType, setPrevPromptType] = useState(promptType);
  if (prevPromptType !== promptType) {
    setPrevPromptType(promptType);
    setPendingAttackers([]);
    setPendingAttacker(null);
    setPendingBlocker(null);
    setAttackDefenderId(null);
    setDamageOrder([]);
    if (promptType === "chooseBlockers") setBlockAssignments([]);
  }

  // Engine handoff: once the gameView carries the locked-in blocks, drop the
  // local pending set so it can't linger as stale staging after combat ends.
  const [prevEngineHasBlocks, setPrevEngineHasBlocks] = useState(engineHasBlocks);
  if (prevEngineHasBlocks !== engineHasBlocks) {
    setPrevEngineHasBlocks(engineHasBlocks);
    if (engineHasBlocks) setBlockAssignments([]);
  }

  const possibleDefenders =
    currentPrompt?.input.type === "chooseAttackers" ? currentPrompt.input.possibleDefenderIds : [];
  const multipleAttackDefenders = possibleDefenders.length > 1;

  // Awaiting-defender state is implicit now: as soon as the user has at
  // least one pending attacker AND there's more than one legal defender
  // (multiplayer / planeswalkers / sieges), the next click on a valid
  // defender commits the whole pending batch against it.
  const awaitingAttackTarget =
    promptType === "chooseAttackers" && multipleAttackDefenders && pendingAttackers.length > 0;

  // Default attackDefenderId to first valid defender during ChooseAttackers.
  if (promptType === "chooseAttackers") {
    if (
      possibleDefenders.length > 0 &&
      (!attackDefenderId || !possibleDefenders.some((d) => d.id === attackDefenderId))
    ) {
      const next = possibleDefenders[0]!.id;
      if (next !== attackDefenderId) setAttackDefenderId(next);
    }
  }

  const playerIsTargetable =
    promptType === "chooseAttackers"
      ? (pid: string) => possibleDefenders.some((defender) => defender.id === pid)
      : promptType === "chooseBoardTargets"
        ? (pid: string) => targetablePlayerIds.includes(pid)
        : () => false;

  /** True when a battlefield card is a legal defender (planeswalker / siege). */
  function cardIsAttackTarget(cardId: string): boolean {
    return awaitingAttackTarget && possibleDefenders.some((defender) => defender.id === cardId);
  }

  function commitAttackAgainst(defenderId: string) {
    if (pendingAttackers.length === 0) return;
    respond(declareAttackersOutput(currentPrompt, pendingAttackers, defenderId));
    setPendingAttackers([]);
  }

  /** "Attack All" — mark every legal attacker as pending. In single-
   *  defender games this commits immediately; in multi-defender games
   *  it leaves the attackers tapped and waiting for the user to click
   *  a target. */
  function selectAllAttackersForPick(attackerIds: string[]) {
    if (attackerIds.length === 0) return;
    if (possibleDefenders.length <= 1) {
      respond(declareAttackersOutput(currentPrompt, attackerIds, possibleDefenders[0]?.id));
      return;
    }
    setPendingAttackers(attackerIds);
  }

  function cancelAttackTargetPick() {
    setPendingAttackers([]);
  }

  function handleTargetPlayer(pid: string) {
    if (awaitingAttackTarget && possibleDefenders.some((d) => d.id === pid)) {
      commitAttackAgainst(pid);
      return;
    }
    if (promptType === "chooseAttackers") {
      setAttackDefenderId(pid);
    } else {
      targetPlayer(pid);
    }
  }

  function handleBattlefieldClick(card: GameCard) {
    if (!currentPrompt) return;

    if (awaitingAttackTarget && possibleDefenders.some((d) => d.id === card.id)) {
      commitAttackAgainst(card.id);
      return;
    }

    if (promptType === "chooseAttackers") {
      if (
        currentPrompt.input.type !== "chooseAttackers" ||
        !currentPrompt.input.availableAttackerIds.includes(card.id)
      ) {
        return;
      }
      setPendingAttackers((prev) =>
        prev.includes(card.id) ? prev.filter((id) => id !== card.id) : [...prev, card.id],
      );
    } else if (promptType === "chooseBlockers") {
      if (
        currentPrompt.input.type !== "chooseBlockers" ||
        !currentPrompt.input.availableBlockerIds.includes(card.id)
      ) {
        return;
      }
      if (pendingAttacker) {
        // Attacker-first: an attacker is selected; clicking a blocker assigns
        // it. Keep `pendingAttacker` so the user can chain blockers onto it.
        assignBlock(card.id, pendingAttacker);
      } else {
        // Blocker-first: no attacker selected yet, so arm this blocker and wait
        // for the user to click the attacker it should block.
        setPendingBlocker((prev) => (prev === card.id ? null : card.id));
      }
    } else if (promptType === "chooseBoardTargets") {
      if (!targetableCardIds.includes(card.id)) return;
      targetCard(card.id);
    } else if (promptType === "chooseDamageAssignmentOrder") {
      if (
        currentPrompt.input.type !== "chooseDamageAssignmentOrder" ||
        !currentPrompt.input.blockerIds.includes(card.id)
      ) {
        return;
      }
      // Click a blocker to append it to the damage order; click an already-
      // ordered one to remove it (everything after re-sequences).
      setDamageOrder((prev) =>
        prev.includes(card.id) ? prev.filter((id) => id !== card.id) : [...prev, card.id],
      );
    }
  }

  function undoDamageOrder() {
    setDamageOrder((prev) => prev.slice(0, -1));
  }

  // MTG 509.1c — each creature blocks at most one attacker. Clicking the same
  // blocker on the same attacker again unassigns it; assigning a blocker that
  // already blocks elsewhere moves it (we never strip the attacker's other
  // blockers — multiple creatures may block one attacker; the engine enforces
  // legality like Menace).
  function assignBlock(blockerId: string, attackerId: string) {
    setBlockAssignments((prev) => {
      const alreadyOnAttacker = prev.some(
        (a) => a.blockerId === blockerId && a.attackerId === attackerId,
      );
      if (alreadyOnAttacker) {
        return prev.filter((a) => !(a.blockerId === blockerId && a.attackerId === attackerId));
      }
      const withoutBlocker = prev.filter((a) => a.blockerId !== blockerId);
      return [...withoutBlocker, { blockerId, attackerId }];
    });
  }

  // Drag-to-block: drop a blocker sprite onto an attacker to assign it directly.
  function assignBlockPair(blockerId: string, attackerId: string) {
    assignBlock(blockerId, attackerId);
    setPendingBlocker(null);
  }

  // Drag-to-unblock: drop a staged blocker back in open space to remove it.
  function unassignBlock(blockerId: string) {
    setBlockAssignments((prev) => prev.filter((a) => a.blockerId !== blockerId));
    setPendingBlocker((prev) => (prev === blockerId ? null : prev));
  }

  function handleAttackerClick(card: GameCard) {
    // Blocker-first: a blocker is armed, so this attacker click completes the
    // assignment instead of selecting the attacker.
    if (pendingBlocker) {
      assignBlock(pendingBlocker, card.id);
      setPendingBlocker(null);
      return;
    }
    setPendingAttacker((prev) => (prev === card.id ? null : card.id));
  }

  return {
    pendingAttackers,
    pendingAttacker,
    pendingBlocker,
    attackDefenderId,
    blockAssignments,
    assignBlockPair,
    unassignBlock,
    damageOrder,
    undoDamageOrder,
    multipleAttackDefenders,
    awaitingAttackTarget,
    playerIsTargetable,
    cardIsAttackTarget,
    handleTargetPlayer,
    handleBattlefieldClick,
    handleAttackerClick,
    selectAllAttackersForPick,
    cancelAttackTargetPick,
  };
}
