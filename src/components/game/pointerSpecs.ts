/**
 * Pure helpers for producing `PointerSpec[]` from the current game state.
 *
 * Pointers are the non-combat counterpart to arrow specs: they describe
 * a targeting relationship (source → target) plus a semantic intent used
 * by the Pixi `PointerLayer` to pick an icon, tint, and glow colour.
 *
 * Attack / block / placement interactions stay in `arrowSpecs.ts`; every
 * other targeting choice flows through here.
 */

import type { PointerSpec } from "@/pixi/types";
import type { StackObject, StackTarget } from "@/types/manabrew";
import { intentPrefersArrow, TargetingIntent } from "@/types/promptType";

export interface BuildPointerSpecsOptions {
  stack?: StackObject[];
  /** If set, treat this stack object as the "active" source instead of the
   *  top-of-stack. Usually the hovered stack entry. */
  activeStackObjectId?: string | null;
}

function getAllTargets(obj: StackObject): StackTarget[] {
  const maybeObj = obj as unknown as Record<string, unknown>;
  const targets = Array.isArray(maybeObj.targets) ? (maybeObj.targets as StackTarget[]) : [];
  if (targets.length > 0) return targets;
  const legacy = typeof maybeObj.targetCardId === "string" ? maybeObj.targetCardId : null;
  if (!legacy) return [];
  return [
    {
      kind: "card",
      id: legacy,
      nodeIndex: 0,
      targetIndex: 0,
      hostile: true,
      intent: TargetingIntent.Hostile,
    },
  ];
}

function targetEndpoint(target: StackTarget): PointerSpec["to"] | null {
  switch (target.kind) {
    case "card":
      return { kind: "card", id: target.id };
    case "player":
      return { kind: "player", id: target.id };
    case "stack":
      return { kind: "stack", id: target.id };
    default:
      return null;
  }
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

export function buildPointerSpecs(opts: BuildPointerSpecsOptions): PointerSpec[] {
  const { stack, activeStackObjectId } = opts;
  const specs: PointerSpec[] = [];

  const activeObj = getActiveStackObject(stack, activeStackObjectId);
  if (!activeObj) return specs;

  const targets = getAllTargets(activeObj);
  if (targets.length === 0) return specs;

  for (const t of targets) {
    const ep = targetEndpoint(t);
    if (!ep) continue;
    const intent = t.intent ?? (t.hostile ? TargetingIntent.Hostile : TargetingIntent.Friendly);
    // Skip intents that render as arrows (attach/attack/block) — those
    // are emitted by `buildArrowSpecs` instead so they aren't double-
    // drawn here as pointer glyphs.
    if (intentPrefersArrow(intent)) continue;
    specs.push({
      from: { kind: "stack", id: activeObj.id },
      to: ep,
      intent,
    });
  }

  return specs;
}
