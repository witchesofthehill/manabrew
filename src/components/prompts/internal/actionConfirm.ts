import type { Prompt, PromptOutput, StepKind } from "@/protocol";
import type { ManaColor, PlayerDto } from "@/protocol/game";
import type { AvailableAction, PaymentAction } from "@/protocol/prompts/common";
import type { ClientGameView } from "@/stores/gameStore.types";
import { PHASE_ORDER } from "@/stores/usePhaseStopStore";

/** One "are you sure?" the board raises before a response leaves the client.
 *  `lines` may contain `{W}`-style symbols — render them with DynamicTextRender. */
export interface ActionConfirmRequest {
  title: string;
  lines: string[];
  confirmLabel: string;
}

export interface ActionConfirmContext {
  prompt: Prompt | null;
  gameView: ClientGameView | null;
  myPlayerId: string;
  confirmUnspentMana: boolean;
  confirmRiskyActions: boolean;
}

const RISKY_COST = /sacrifice|\bsac\b|discard|\blife\b/i;

function manaPoolSymbols(pool: PlayerDto["manaPool"]): string {
  return Object.entries(pool)
    .flatMap(([color, amount]) => Array.from({ length: amount ?? 0 }, () => `{${color}}`))
    .join("");
}

function manaPoolTotal(pool: PlayerDto["manaPool"]): number {
  return (Object.keys(pool) as ManaColor[]).reduce((sum, color) => sum + (pool[color] ?? 0), 0);
}

/** True when the pass target lands outside the turn currently being played, so
 *  anything only playable this turn (the land drop) is gone for good. */
function passLeavesTurn(
  until: { playerId: string; phase: StepKind } | undefined,
  myPlayerId: string,
  step: StepKind,
): boolean {
  if (!until) return true;
  if (until.playerId !== myPlayerId) return true;
  return PHASE_ORDER.indexOf(until.phase) <= PHASE_ORDER.indexOf(step);
}

function unusedLandDrop(ctx: ActionConfirmContext): boolean {
  if (ctx.prompt?.input.type !== "chooseAction") return false;
  const hand = ctx.gameView?.players.find((p) => p.id === ctx.myPlayerId)?.hand ?? [];
  return ctx.prompt.input.actions.some(
    (action) =>
      action.type === "cast" &&
      hand.some((card) => card.id === action.cardId && card.types.includes("Land")),
  );
}

function passConfirm(
  output: Extract<PromptOutput["output"], { type: "pass" }>,
  ctx: ActionConfirmContext,
): ActionConfirmRequest | null {
  const gameView = ctx.gameView;
  if (!gameView) return null;
  const me = gameView.players.find((p) => p.id === ctx.myPlayerId);
  const lines: string[] = [];

  // Floating mana only survives while the stack is resolving; a pass that ends
  // the step empties the pool.
  if (ctx.confirmUnspentMana && me && gameView.stack.length === 0) {
    const total = manaPoolTotal(me.manaPool);
    if (total > 0) {
      lines.push(
        `${manaPoolSymbols(me.manaPool)} is still in your mana pool and empties when the step ends.`,
      );
    }
  }

  if (
    ctx.confirmRiskyActions &&
    gameView.activePlayerId === ctx.myPlayerId &&
    passLeavesTurn(output.until, ctx.myPlayerId, gameView.step) &&
    unusedLandDrop(ctx)
  ) {
    lines.push("You can still play a land this turn.");
  }

  if (lines.length === 0) return null;
  return { title: "Pass anyway?", lines, confirmLabel: "Pass" };
}

function combatConfirm(
  output: Extract<PromptOutput["output"], { type: "declareAttackers" | "declareBlockers" }>,
  ctx: ActionConfirmContext,
): ActionConfirmRequest | null {
  if (!ctx.confirmRiskyActions) return null;
  const count = output.assignments.length;

  if (output.type === "declareAttackers") {
    if (count === 0) return null;
    return {
      title: "Declare attackers?",
      lines: [`${count} attacker${count === 1 ? "" : "s"} — this can't be taken back.`],
      confirmLabel: "Attack",
    };
  }

  if (count === 0) {
    const canBlock =
      ctx.prompt?.input.type === "chooseBlockers" &&
      ctx.prompt.input.attackers.some((a) => a.validBlockerIds.length > 0);
    if (!canBlock) return null;
    return {
      title: "Block nothing?",
      lines: ["Every attacker gets through, and you can still block."],
      confirmLabel: "No blocks",
    };
  }
  return {
    title: "Declare blockers?",
    lines: [`${count} block${count === 1 ? "" : "s"} — this can't be taken back.`],
    confirmLabel: "Block",
  };
}

function actConfirm(
  output: Extract<PromptOutput["output"], { type: "act" }>,
  ctx: ActionConfirmContext,
): ActionConfirmRequest | null {
  if (!ctx.confirmRiskyActions) return null;
  const input = ctx.prompt?.input;
  if (input?.type !== "chooseAction" && input?.type !== "payManaCost") return null;
  const actions: (AvailableAction | PaymentAction)[] = input.actions;
  const action = actions.find((a) => a.id === output.actionId);
  if (!action) return null;

  if (action.type === "payLife") {
    return {
      title: `Pay ${action.amount} life?`,
      lines: ["Life paid for a cost is never refunded."],
      confirmLabel: "Pay",
    };
  }
  if (action.type !== "activateAbility" || action.isManaAbility) return null;
  if (!action.cost || !RISKY_COST.test(action.cost)) return null;
  return {
    title: "Activate this ability?",
    lines: [action.description, `Cost: ${action.cost}`],
    confirmLabel: "Activate",
  };
}

/** The confirmation a response should raise before it is sent, or null to send
 *  it straight through. Pure — the caller owns the modal and the retry. */
export function actionConfirmRequest(
  output: PromptOutput["output"],
  ctx: ActionConfirmContext,
): ActionConfirmRequest | null {
  switch (output.type) {
    case "pass":
      return passConfirm(output, ctx);
    case "declareAttackers":
    case "declareBlockers":
      return combatConfirm(output, ctx);
    case "act":
      return actConfirm(output, ctx);
    default:
      return null;
  }
}
