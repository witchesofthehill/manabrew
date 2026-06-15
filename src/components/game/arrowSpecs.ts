/**
 * Pure helpers for producing `ArrowSpec[]` from the current game state.
 *
 * Arrows are reserved for combat declarations (attack/block) and the
 * placement preview when casting a permanent spell.
 *
 * The Pixi renderer resolves these specs to canvas-local coordinates
 * every tick so arrows follow animating sprites.
 */

import type { ArrowSpec } from "@/pixi/types";
import type { StackObject, StackTarget } from "@/types/manabrew";
import { TargetingIntent } from "@/types/promptType";
import type { PromptType } from "@/protocol";

export interface BuildArrowSpecsOptions {
  promptType?: PromptType;
  attackerIds: string[];
  blockAssignments: { blockerId: string; attackerId: string }[];
  combatAssignments: { blockerId: string; attackerId: string }[];
  battlefieldAttachments?: { childId: string; parentId: string }[];
  /** Locked-in attackers from the engine's battlefield state — every
   *  battlefield card with `isAttacking && attackingPlayerId`. Drives
   *  the persistent attack arrow shown throughout combat (after
   *  declaration, during blockers, during damage). Pre-commit pending
   *  attackers are signalled via card-tap visuals only (Game.tsx),
   *  never an arrow — multiple opponents / planeswalkers / sieges make
   *  any "default" destination misleading. */
  activeAttackers: { attackerId: string; defenderId: string }[];
  stack?: StackObject[];
  /** If set, treat this stack object as the "active" source for the
   *  placement arrow (usually the hovered one) instead of the top-of-stack. */
  activeStackObjectId?: string | null;
  /** When true, block relationships are conveyed by MTGA-style spatial
   *  staging (blockers line up under their attacker) instead of arrows, so
   *  no `block` arrows are emitted. Attack arrows are unaffected. */
  stageBlockers?: boolean;
}

function getActiveStackObject(
  stack: StackObject[] | undefined,
  activeStackObjectId?: string | null,
): StackObject | null {
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

  // Locked-in attackers: persist throughout combat (declared → blockers →
  // damage) using the engine's per-card attacking state.
  for (const { attackerId, defenderId } of activeAttackers) {
    specs.push({
      from: { kind: "card", id: attackerId },
      to: { kind: "player", id: defenderId },
      type: "attack",
    });
  }

  // Block relationships are shown by spatial staging, not arrows, when
  // `stageBlockers` is on (blockers line up beneath their attacker).
  if (!stageBlockers) {
    // Mid-selection block assignments while ChooseBlockers is active.
    if (promptType === "chooseBlockers") {
      for (const { blockerId, attackerId } of blockAssignments) {
        specs.push({
          from: { kind: "card", id: blockerId },
          to: { kind: "card", id: attackerId },
          type: "block",
        });
      }
    }

    // Locked-in block assignments from the engine combat state (persist
    // through damage assignment / end of combat).
    for (const { blockerId, attackerId } of combatAssignments) {
      specs.push({
        from: { kind: "card", id: blockerId },
        to: { kind: "card", id: attackerId },
        type: "block",
      });
    }
  }

  // Placement ghost preview stays as an arrow (dashed marching-ants) — it
  // signals "drop here" rather than a targeting relationship.
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

  // Attach relationships: any stack object whose chosen targets carry the
  // `Attach` intent (Equipment / Aura targeting) emits a rune-style
  // arrow from the spell to its target. Pointer specs deliberately skip
  // these intents so we don't double-render.
  if (activeObj) {
    const objAny = activeObj as unknown as Record<string, unknown>;
    const targets = Array.isArray(objAny.targets) ? (objAny.targets as StackTarget[]) : [];
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
