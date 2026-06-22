import type { PointerSpec } from "@/pixi/types";
import type { StackObject, StackTarget } from "@/types/manabrew";
import { intentPrefersArrow, TargetingIntent } from "@/types/promptType";

export interface BuildPointerSpecsOptions {
  stack?: StackObject[];
  activeStackObjectId?: string | null;
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

function getTargets(obj: StackObject): StackTarget[] {
  const maybeObj = obj as unknown as Record<string, unknown>;
  return Array.isArray(maybeObj.targets) ? (maybeObj.targets as StackTarget[]) : [];
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

export function buildPointerSpecs(opts: BuildPointerSpecsOptions): PointerSpec[] {
  const activeObj = getActiveStackObject(opts.stack, opts.activeStackObjectId);
  if (!activeObj) return [];
  const specs: PointerSpec[] = [];
  for (const target of getTargets(activeObj)) {
    if (target.kind === "stack") continue;
    const to = targetEndpoint(target);
    if (!to) continue;
    const intent =
      target.intent ?? (target.hostile ? TargetingIntent.Hostile : TargetingIntent.Friendly);
    if (intentPrefersArrow(intent)) continue;
    specs.push({
      from: { kind: "stack", id: activeObj.id },
      to,
      intent,
    });
  }
  return specs;
}
