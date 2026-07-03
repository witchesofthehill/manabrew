import type { ArrowSpec } from "@/pixi/types";
import type { StackObjectDto } from "@/protocol/game";
import { intentIsHostile } from "@/types/promptType";
import type { PromptType } from "@/protocol";

export interface BuildArrowSpecsOptions {
  promptType?: PromptType;
  attackerIds: string[];
  blockAssignments: { blockerId: string; attackerId: string }[];
  combatAssignments: { blockerId: string; attackerId: string }[];
  // Attacker→target arrows. `targetKind` picks the endpoint: "player" anchors to
  // the defender's avatar; "card" anchors to the specific planeswalker/battle
  // being attacked (drag-declared attacks know their exact target).
  activeAttackers: { attackerId: string; targetId: string; targetKind: "player" | "card" }[];
  stack?: StackObjectDto[];
  activeStackObjectId?: string | null;
  stageBlockers?: boolean;
  cardZoneTiles?: Map<string, { playerId: string; key: string }>;
}

function getActiveStackObject(
  stack: StackObjectDto[] | undefined,
  activeStackObjectId?: string | null,
): StackObjectDto | null {
  if (!stack || stack.length === 0) return null;
  if (activeStackObjectId) {
    const hit = stack.find((obj) => obj.id === activeStackObjectId);
    if (hit) return hit;
  }
  return stack[stack.length - 1] ?? null;
}

export function buildArrowSpecs(opts: BuildArrowSpecsOptions): ArrowSpec[] {
  const {
    promptType,
    blockAssignments,
    combatAssignments,
    activeAttackers,
    stack,
    activeStackObjectId,
    stageBlockers,
    cardZoneTiles,
  } = opts;

  const specs: ArrowSpec[] = [];

  for (const { attackerId, targetId, targetKind } of activeAttackers) {
    specs.push({
      from: { kind: "card", id: attackerId },
      to: targetKind === "card" ? { kind: "card", id: targetId } : { kind: "player", id: targetId },
      type: "attack",
    });
  }

  if (!stageBlockers) {
    if (promptType === "chooseBlockers") {
      for (const { blockerId, attackerId } of blockAssignments) {
        specs.push({
          from: { kind: "card", id: blockerId },
          to: { kind: "card", id: attackerId },
          type: "block",
        });
      }
    }

    for (const { blockerId, attackerId } of combatAssignments) {
      specs.push({
        from: { kind: "card", id: blockerId },
        to: { kind: "card", id: attackerId },
        type: "block",
      });
    }
  }

  const activeObj = getActiveStackObject(stack, activeStackObjectId);
  if (activeObj && activeObj.isPermanentSpell === true) {
    const hasTargets = activeObj.targets.length > 0;
    if (!hasTargets) {
      specs.push({
        from: { kind: "stack", id: activeObj.id },
        // Anchor the ghost to the spell's controller — opponent permanent
        // spells preview into the opponent's battlefield, not ours.
        to: { kind: "placement-ghost", playerId: activeObj.controllerId },
        type: "placement",
      });
    }
  }

  if (activeObj) {
    for (const t of activeObj.targets) {
      const tile = t.kind === "card" ? cardZoneTiles?.get(t.id) : undefined;
      const to: ArrowSpec["to"] | null =
        t.kind === "card"
          ? tile
            ? { kind: "zone-tile", playerId: tile.playerId, key: tile.key }
            : { kind: "card", id: t.id }
          : t.kind === "player"
            ? { kind: "player", id: t.id }
            : t.kind === "spell"
              ? { kind: "stack", id: t.id }
              : null;
      if (!to) continue;
      specs.push({
        from: { kind: "stack", id: activeObj.id },
        to,
        type: "casting",
        hostile: t.intent != null && intentIsHostile(t.intent),
      });
    }
  }

  return specs;
}
