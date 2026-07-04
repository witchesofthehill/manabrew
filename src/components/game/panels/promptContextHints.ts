export const ATTACK_DRAG_HINT =
  "Drag a creature onto a target — or tap the creature, then its target — to attack.";

export interface PromptContextInfo {
  mulliganCount?: number;
  mustAttackHint?: string | null;
  blockRestrictionHint?: string | null;
  payManaCostInfo?: {
    cardName: string;
    manaCost: string;
    description?: string;
    delveCount?: number;
  } | null;
  mulliganPutBackCount?: number;
  mulliganSelectedCount?: number;
}

export function getPromptContextLines(
  promptType: string | undefined,
  info: PromptContextInfo,
): string[] {
  switch (promptType) {
    case "mulligan":
      return info.mulliganCount
        ? [`Mulligan ${info.mulliganCount} — keeping puts ${info.mulliganCount} back.`]
        : ["Keep this hand, or mulligan to draw a new one."];
    case "mulliganPutBack":
      return [
        `${info.mulliganSelectedCount ?? 0}/${info.mulliganPutBackCount ?? 0} to library bottom`,
      ];
    case "chooseAction":
      return ["Tap PASS to pass priority."];
    case "chooseAttackers": {
      const lines = [ATTACK_DRAG_HINT];
      if (info.mustAttackHint) lines.unshift(info.mustAttackHint);
      return lines;
    }
    case "chooseBlockers": {
      const lines = ["Tap an attacker, then your blocker, to assign a block."];
      if (info.blockRestrictionHint) lines.unshift(info.blockRestrictionHint);
      return lines;
    }
    case "payManaCost": {
      const cost = info.payManaCostInfo;
      if (!cost) return [];
      const lines = [cost.description || `Cast ${cost.cardName} for ${cost.manaCost}`];
      if (cost.delveCount) lines.push(`Delved for {${cost.delveCount}}`);
      return lines;
    }
    default:
      return [];
  }
}
