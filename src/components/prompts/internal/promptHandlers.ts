import type { PromptType } from "@/protocol";
import type { Prompt } from "@/protocol";
import type {
  PromptInput,
  PromptOutput,
  PromptRequest,
  PromptType as PromptKind,
} from "@/protocol";

export type RespondPayload = PromptOutput["output"];
type PromptOf<TType extends PromptKind> = PromptRequest<Extract<PromptInput, { type: TType }>>;

export type AutoResolution =
  | {
      kind: "auto";
      respond: RespondPayload;
      reason: string;
    }
  | { kind: "force-show" };

export interface ResolveCtx {
  prefs: PromptPreferencesSnapshot;
  targetIntents: Record<string, { kind: "card" | "player" | "spell"; id: string }>;
}

export interface PromptPreferencesSnapshot {
  show: Partial<Record<PromptType, boolean>>;
}

export type PromptResolver<TType extends PromptKind = PromptKind> = {
  resolve(prompt: PromptOf<TType>, ctx: ResolveCtx): AutoResolution;
}["resolve"];

export interface PromptHandler<TType extends PromptKind = PromptKind> {
  showByDefault: boolean;
  resolve?: PromptResolver<TType>;
}

import * as informational from "./informational";
import * as forced from "./forced";
import * as optionalCosts from "./optionalCosts";

const DEFAULT_PROMPT_HANDLER: PromptHandler = { showByDefault: true };

const PROMPT_HANDLER_OVERRIDES: Partial<{
  [TType in PromptKind]: PromptHandler<TType>;
}> = {
  ["chooseAction"]: { showByDefault: false },
  ["chooseAttackers"]: { showByDefault: false },
  ["chooseBlockers"]: { showByDefault: false },
  ["chooseDamageAssignmentOrder"]: {
    showByDefault: true,
    resolve: forced.singleBlockerOrder,
  },
  ["chooseCombatDamageAssignment"]: {
    showByDefault: true,
    resolve: forced.singleAssigneeDamage,
  },
  ["chooseBoardTargets"]: { showByDefault: true, resolve: forced.singleLegalBoardTarget },

  ["revealCards"]: { showByDefault: true, resolve: informational.ackReveal },
  ["chooseFromSelection"]: { showByDefault: true, resolve: forced.forcedAllSelections },
  ["chooseColor"]: { showByDefault: true, resolve: forced.singleLegalColor },
  ["chooseType"]: { showByDefault: true, resolve: forced.singleLegalType },
  ["chooseNumber"]: { showByDefault: true, resolve: forced.singleLegalNumber },
  ["chooseCardName"]: { showByDefault: true, resolve: forced.singleLegalName },
  ["chooseBoolean"]: { showByDefault: true, resolve: optionalCosts.skipBoolean },
  ["chooseCards"]: { showByDefault: true, resolve: forced.forcedCardChoice },
  ["reorderCards"]: { showByDefault: true, resolve: forced.singleCardOrder },
  ["scry"]: { showByDefault: true, resolve: forced.emptyScry },
  ["diceRolled"]: { showByDefault: true, resolve: informational.ackDiceRolled },
};

export function getPromptHandler<TType extends PromptKind>(
  promptType: TType,
): PromptHandler<TType> {
  return (PROMPT_HANDLER_OVERRIDES[promptType] ?? DEFAULT_PROMPT_HANDLER) as PromptHandler<TType>;
}

export function resolvePrompt(prompt: Prompt, ctx: ResolveCtx): AutoResolution {
  const handler = getPromptHandler(prompt.input.type);

  const resolverResult = handler.resolve?.(prompt, ctx) ?? { kind: "force-show" };
  if (resolverResult.kind === "auto") return resolverResult;

  const overridden = ctx.prefs.show[prompt.input.type];
  const show = overridden ?? handler.showByDefault;
  if (!show) {
    if (typeof console !== "undefined" && import.meta.env?.DEV) {
      console.warn(
        `[prompt-resolver] ${prompt.input.type} is toggled off but resolver returned force-show; ` +
          `showing modal as a fallback. Add a resolver branch if this case is auto-answerable.`,
      );
    }
  }
  return { kind: "force-show" };
}

export function effectiveShow(promptType: PromptType, prefs: PromptPreferencesSnapshot): boolean {
  return prefs.show[promptType] ?? getPromptHandler(promptType).showByDefault;
}

export function isToggledOff(promptType: PromptType, ctx: ResolveCtx): boolean {
  return ctx.prefs.show[promptType] === false;
}
