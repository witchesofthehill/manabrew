import { useState } from "react";
import type { CardDto } from "@/protocol/game";
import type { Prompt } from "@/protocol";
import type { PromptOutput } from "@/protocol";
import { declareAttackersOutput } from "@/components/prompts/internal/playerActions";

export interface CombatAssignment {
  blockerId: string;
  attackerId: string;
}

export interface BlockRequirementViolation {
  attackerId: string;
  assigned: number;
  kind: "min" | "max";
  count: number;
}

interface UseCombatStateOptions {
  promptType: string | undefined;
  targetCard: (cardId: string) => void;
  targetPlayer: (playerId: string) => void;
  respond: (output: PromptOutput["output"]) => void;
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
  const [attackAssignments, setAttackAssignments] = useState<
    { attackerId: string; targetId: string }[]
  >([]);
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
    setAttackAssignments([]);
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
    currentPrompt?.input.type === "chooseAttackers" ? currentPrompt.input.attackTargets : [];
  const multipleAttackDefenders = possibleDefenders.length > 1;

  const attackerOptions =
    currentPrompt?.input.type === "chooseAttackers" ? currentPrompt.input.attackers : [];
  const stagedTargetIds: Set<string> | null = (() => {
    if (promptType !== "chooseAttackers" || pendingAttackers.length === 0) return null;
    let acc: string[] | null = null;
    for (const id of pendingAttackers) {
      const valid = attackerOptions.find((a) => a.attackerId === id)?.validTargetIds ?? [];
      acc = acc == null ? [...valid] : acc.filter((x) => valid.includes(x));
    }
    return new Set(acc ?? []);
  })();
  const defenderIsTargetable = (id: string): boolean =>
    possibleDefenders.some((d) => d.id === id) &&
    (stagedTargetIds == null || stagedTargetIds.has(id));

  // Per-attacker block legality the engine reported; drives which blocker→
  // attacker pairings are allowed (and the menace/error feedback in the UI).
  const blockableAttackers =
    currentPrompt?.input.type === "chooseBlockers" ? currentPrompt.input.attackers : [];
  const blockError =
    currentPrompt?.input.type === "chooseBlockers" ? currentPrompt.input.error : undefined;
  // An attacker whose minimum can't be met by its legal blockers can't be
  // blocked at all (e.g. "all creatures must block it" while one is tapped).
  // Treat it as unblockable so a partial assignment can't dead-end the
  // declaration with the Block button stuck disabled.
  const attackerIsBlockable = (a: { validBlockerIds: string[]; minBlockers: number }): boolean =>
    a.validBlockerIds.length >= a.minBlockers;
  const canBlock = (blockerId: string, attackerId: string): boolean => {
    const attacker = blockableAttackers.find((a) => a.attackerId === attackerId);
    return (
      !!attacker && attackerIsBlockable(attacker) && attacker.validBlockerIds.includes(blockerId)
    );
  };

  // First attacker whose current block count breaks its min/max requirement
  // (menace, "can't be blocked unless all block it", "can't be blocked by more
  // than N"). An attacker with zero blockers is fine — blocking is optional.
  const blockRequirement: BlockRequirementViolation | null =
    blockableAttackers.reduce<BlockRequirementViolation | null>((found, a) => {
      if (found) return found;
      const assigned = blockAssignments.filter((b) => b.attackerId === a.attackerId).length;
      if (assigned === 0) return null;
      if (assigned < a.minBlockers) {
        return { attackerId: a.attackerId, assigned, kind: "min", count: a.minBlockers };
      }
      if (a.maxBlockers != null && assigned > a.maxBlockers) {
        return { attackerId: a.attackerId, assigned, kind: "max", count: a.maxBlockers };
      }
      return null;
    }, null);

  // Click-to-assign flow (alongside drag): once the user has at least one
  // pending attacker (tapped a creature), the next click on a valid defender
  // assigns the whole pending batch to it. Available even with a single legal
  // defender so tapping a creature then the target always works.
  const awaitingAttackTarget = promptType === "chooseAttackers" && pendingAttackers.length > 0;

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
      ? (pid: string) => defenderIsTargetable(pid)
      : promptType === "chooseBoardTargets"
        ? (pid: string) => targetablePlayerIds.includes(pid)
        : () => false;

  function assignPendingToTarget(defenderId: string) {
    if (pendingAttackers.length === 0) return;
    // Accumulate into attackAssignments (staged in the target's band) and let the
    // Attack button submit — same path drag uses, so both flows behave alike.
    const pendingSet = new Set(pendingAttackers);
    setAttackAssignments((prev) => [
      ...prev.filter((a) => !pendingSet.has(a.attackerId)),
      ...pendingAttackers.map((id) => ({ attackerId: id, targetId: defenderId })),
    ]);
    setPendingAttackers([]);
  }

  function submitAttack() {
    const available =
      currentPrompt?.input.type === "chooseAttackers"
        ? new Set(currentPrompt.input.attackers.map((a) => a.attackerId))
        : null;
    // Fold any still-pending (tapped-but-untargeted) attackers into the default
    // defender so the tap flow and the drag flow submit together — but only when
    // that defender is actually legal for the attacker, so a multi-defender Space
    // can't ship an illegal (attacker, arbitrary-default) pairing to the engine.
    const pendingPairs =
      attackDefenderId != null
        ? pendingAttackers
            .filter((id) =>
              (attackerOptions.find((a) => a.attackerId === id)?.validTargetIds ?? []).includes(
                attackDefenderId,
              ),
            )
            .map((id) => ({ attackerId: id, targetId: attackDefenderId }))
        : [];
    const assignedIds = new Set(attackAssignments.map((a) => a.attackerId));
    const merged = [
      ...attackAssignments,
      ...pendingPairs.filter((p) => !assignedIds.has(p.attackerId)),
    ];
    const assignments = available ? merged.filter((a) => available.has(a.attackerId)) : merged;
    if (assignments.length === 0) return;
    respond({ type: "declareAttackers", assignments });
    setAttackAssignments([]);
    setPendingAttackers([]);
  }

  // Drag-to-attack: drop a creature onto a defender (player / planeswalker /
  // battle) to assign it directly. Upserts so re-dropping moves the attacker.
  function assignAttackPair(attackerId: string, targetId: string) {
    const valid = attackerOptions.find((a) => a.attackerId === attackerId)?.validTargetIds ?? [];
    if (!valid.includes(targetId)) return;
    setAttackAssignments((prev) => [
      ...prev.filter((a) => a.attackerId !== attackerId),
      { attackerId, targetId },
    ]);
    setPendingAttackers((prev) => prev.filter((id) => id !== attackerId));
  }

  // Drag-to-unattack: drop a staged attacker back on our own field to remove it.
  function unassignAttack(attackerId: string) {
    setAttackAssignments((prev) => prev.filter((a) => a.attackerId !== attackerId));
    setPendingAttackers((prev) => prev.filter((id) => id !== attackerId));
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
    const assigned = new Set(attackAssignments.map((a) => a.attackerId));
    setPendingAttackers(attackerIds.filter((id) => !assigned.has(id)));
  }

  function cancelAttackTargetPick() {
    setPendingAttackers([]);
  }

  function handleTargetPlayer(pid: string) {
    if (awaitingAttackTarget && defenderIsTargetable(pid)) {
      assignPendingToTarget(pid);
      return;
    }
    if (promptType === "chooseAttackers") {
      setAttackDefenderId(pid);
    } else {
      targetPlayer(pid);
    }
  }

  function handleBattlefieldClick(card: CardDto) {
    if (!currentPrompt) return;

    if (awaitingAttackTarget && defenderIsTargetable(card.id)) {
      assignPendingToTarget(card.id);
      return;
    }

    if (promptType === "chooseAttackers") {
      if (
        currentPrompt.input.type !== "chooseAttackers" ||
        !currentPrompt.input.attackers.some((a) => a.attackerId === card.id)
      ) {
        return;
      }
      if (attackAssignments.some((a) => a.attackerId === card.id)) {
        setAttackAssignments((prev) => prev.filter((a) => a.attackerId !== card.id));
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
      toggleDamageOrder(card.id);
    }
  }

  function toggleDamageOrder(cardId: string) {
    if (
      currentPrompt?.input.type !== "chooseDamageAssignmentOrder" ||
      !currentPrompt.input.blockerIds.includes(cardId)
    ) {
      return;
    }
    setDamageOrder((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId],
    );
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
    // Honor the engine's per-attacker legality — illegal pairings are ignored.
    if (!canBlock(blockerId, attackerId)) return;
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

  function handleAttackerClick(card: CardDto) {
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
    attackAssignments,
    submitAttack,
    assignAttackPair,
    unassignAttack,
    pendingAttacker,
    pendingBlocker,
    attackDefenderId,
    blockAssignments,
    blockError,
    blockRequirement,
    assignBlockPair,
    unassignBlock,
    damageOrder,
    toggleDamageOrder,
    undoDamageOrder,
    multipleAttackDefenders,
    awaitingAttackTarget,
    playerIsTargetable,
    handleTargetPlayer,
    handleBattlefieldClick,
    handleAttackerClick,
    selectAllAttackersForPick,
    cancelAttackTargetPick,
  };
}
