import type { PointerSpec } from "@/pixi/types";
import type { StackObject, StackTarget } from "@/types/manabrew";
import { intentPrefersArrow } from "@/types/promptType";

export interface BuildPointerSpecsOptions {
  stack?: StackObject[];
  activeStackObjectId?: string | null;
  includeStackTargets?: boolean;
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
    case "spell":
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
    if (target.kind === "spell") continue;
    const to = targetEndpoint(target);
    if (!to) continue;
    const intent = target.intent;
    if (intentPrefersArrow(intent)) continue;
    specs.push({
      from: { kind: "stack", id: activeObj.id },
      to,
      intent,
    });
  }
  if (opts.includeStackTargets) {
    for (const stackObj of opts.stack ?? []) {
      for (const target of getTargets(stackObj)) {
        if (target.kind !== "spell" || target.id === stackObj.id) continue;
        const to = targetEndpoint(target);
        if (!to) continue;
        const intent = target.intent;
        if (intentPrefersArrow(intent)) continue;
        specs.push({
          from: { kind: "stack", id: stackObj.id },
          to,
          intent,
        });
      }
    }
  }
  return specs;
}
