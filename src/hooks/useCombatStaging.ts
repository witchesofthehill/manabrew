import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { GameCard } from "@/types/manabrew";
import type { PixiGameScene, SceneCombatStaging, StagedBlocker } from "@/pixi/PixiGameScene";

interface CombatAssignment {
  blockerId: string;
  attackerId: string;
}

interface UseCombatStagingOptions {
  promptType: string | undefined;
  combatAssignments: CombatAssignment[];
  blockAssignments: CombatAssignment[];
  battlefield: GameCard[];
  localPlayerId: string | undefined;
  mainSceneRef: MutableRefObject<PixiGameScene | null>;
  opponentSceneRefs: Map<string, MutableRefObject<PixiGameScene | null>>;
}

interface SceneAcc {
  attackerIds: Set<string>;
  blockers: StagedBlocker[];
  blockerIds: Set<string>;
}

/**
 * MTGA-style combat line-up coordinator. Blockers and the attackers they
 * block live in separate Pixi scenes (one canvas per player), so alignment
 * is brokered here in shared viewport space: each attacker's resting
 * screen-x is read from its owning scene and handed to the scene holding
 * its blockers, which pull them to their front edge beneath it. Driven by
 * the same data as the (now suppressed) block arrows — engine
 * `combatAssignments` plus the local `blockAssignments` mid-selection.
 *
 * Reads stable target positions, so it re-runs only on combat-data /
 * battlefield / resize changes, not per frame. Clearing the staging (no
 * blocks) lets every card lerp back to its home slot.
 */
export function useCombatStaging({
  promptType,
  combatAssignments,
  blockAssignments,
  battlefield,
  localPlayerId,
  mainSceneRef,
  opponentSceneRefs,
}: UseCombatStagingOptions): void {
  const blockKey =
    combatAssignments.map((a) => `${a.blockerId}:${a.attackerId}`).join(",") +
    "|" +
    (promptType === "chooseBlockers"
      ? blockAssignments.map((a) => `${a.blockerId}:${a.attackerId}`).join(",")
      : "");

  useEffect(() => {
    const apply = () => {
      const controllerByCard = new Map<string, string>();
      for (const c of battlefield) controllerByCard.set(c.id, c.controllerId);

      const allScenes: PixiGameScene[] = [];
      if (mainSceneRef.current) allScenes.push(mainSceneRef.current);
      for (const ref of opponentSceneRefs.values()) {
        if (ref.current) allScenes.push(ref.current);
      }

      const sceneForCard = (cardId: string): PixiGameScene | null => {
        const controllerId = controllerByCard.get(cardId);
        if (!controllerId) return null;
        if (controllerId === localPlayerId) return mainSceneRef.current;
        return opponentSceneRefs.get(controllerId)?.current ?? null;
      };

      // Effective blocks: locked-in engine assignments plus the local
      // pending picks while choosing blockers, deduped by blocker.
      const effective = new Map<string, string>();
      for (const a of combatAssignments) effective.set(a.blockerId, a.attackerId);
      if (promptType === "chooseBlockers") {
        for (const a of blockAssignments) effective.set(a.blockerId, a.attackerId);
      }

      const acc = new Map<PixiGameScene, SceneAcc>();
      const accFor = (scene: PixiGameScene): SceneAcc => {
        let a = acc.get(scene);
        if (!a) {
          a = { attackerIds: new Set(), blockers: [], blockerIds: new Set() };
          acc.set(scene, a);
        }
        return a;
      };

      // Group blockers by the attacker they block, then assign each lane.
      const blockersByAttacker = new Map<string, string[]>();
      for (const [blockerId, attackerId] of effective) {
        const list = blockersByAttacker.get(attackerId);
        if (list) list.push(blockerId);
        else blockersByAttacker.set(attackerId, [blockerId]);
      }

      for (const [attackerId, blockerIds] of blockersByAttacker) {
        const attackerScene = sceneForCard(attackerId);
        const laneScreenX = attackerScene?.getCardTargetScreenX(attackerId) ?? null;
        if (attackerScene === null || laneScreenX === null) continue;
        accFor(attackerScene).attackerIds.add(attackerId);
        blockerIds.forEach((blockerId, i) => {
          const blockerScene = sceneForCard(blockerId);
          if (!blockerScene) return;
          const a = accFor(blockerScene);
          a.blockers.push({
            id: blockerId,
            laneScreenX,
            indexInLane: i,
            laneCount: blockerIds.length,
          });
          a.blockerIds.add(blockerId);
        });
      }

      for (const scene of allScenes) {
        const a = acc.get(scene);
        const staging: SceneCombatStaging | null =
          a && (a.attackerIds.size > 0 || a.blockers.length > 0)
            ? { attackerIds: a.attackerIds, blockers: a.blockers, blockerIds: a.blockerIds }
            : null;
        scene.setCombatStaging(staging);
      }
    };

    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockKey, battlefield, localPlayerId, mainSceneRef, opponentSceneRefs]);
}
