import type { ArrowSpec } from "@/pixi/types";
import type { StackObjectDto, StackTargetDto } from "@/protocol/game";
import { TargetingIntent } from "@/types/promptType";
import type { PromptType } from "@/protocol";

export interface BuildArrowSpecsOptions {
  promptType?: PromptType;
  attackerIds: string[];
  blockAssignments: { blockerId: string; attackerId: string }[];
  combatAssignments: { blockerId: string; attackerId: string }[];
  battlefieldAttachments?: { childId: string; parentId: string }[];
  // Pre-commit pending attackers are signalled via card-tap visuals only
  // (Game.tsx), never an arrow — multiple opponents / planeswalkers / sieges
  // make any "default" destination misleading.
  activeAttackers: { attackerId: string; defenderId: string }[];
  stack?: StackObjectDto[];
  activeStackObjectId?: string | null;
  stageBlockers?: boolean;
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
    battlefieldAttachments,
    stack,
    activeStackObjectId,
    stageBlockers,
  } = opts;

  const specs: ArrowSpec[] = [];

  if (battlefieldAttachments) {
    for (const { childId, parentId } of battlefieldAttachments) {
      specs.push({
        from: { kind: "card", id: childId },
        to: { kind: "card", id: parentId },
        type: "attach",
      });
    }
  }

  for (const { attackerId, defenderId } of activeAttackers) {
    specs.push({
      from: { kind: "card", id: attackerId },
      to: { kind: "player", id: defenderId },
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
    const hasTargets =
      Array.isArray((activeObj as unknown as Record<string, unknown>).targets) &&
      (activeObj as unknown as { targets: unknown[] }).targets.length > 0;
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
    const objAny = activeObj as unknown as Record<string, unknown>;
    const targets = Array.isArray(objAny.targets) ? (objAny.targets as StackTargetDto[]) : [];
    for (const t of targets) {
      if (t.intent !== TargetingIntent.Attach) continue;
      const to: ArrowSpec["to"] | null =
        t.kind === "card"
          ? { kind: "card", id: t.id }
          : t.kind === "player"
            ? { kind: "player", id: t.id }
            : t.kind === "stack"
              ? { kind: "stack", id: t.id }
              : null;
      if (!to) continue;
      specs.push({
        from: { kind: "stack", id: activeObj.id },
        to,
        type: "attach",
      });
    }
  }

  return specs;
}
