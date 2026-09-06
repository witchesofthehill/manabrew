import type { Prompt } from "@manabrew/protocol";
export function constrainSelection(input: Prompt["input"] | undefined, ids: string[]) {
  const unique = [...new Set(ids)];
  const max =
    input?.type === "chooseBoardTargets"
      ? input.maxTargets
      : input?.type === "chooseCards"
        ? input.max
        : input?.type === "mulliganPutBack"
          ? input.count
          : input?.type === "chooseBlockers"
            ? 1
            : Infinity;
  return max === 1 ? unique.slice(-1) : unique.slice(0, Math.max(0, max));
}
