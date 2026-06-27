import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { MainActionOverlayProps } from "../game.types";
import { PromptActionController } from "@/components/prompts/PromptActionController";
import { CombatInfo } from "./CombatInfo";
import { PHASES } from "../game.constants";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { type PromptActionViewKey, useGameDevStore } from "@/stores/useGameDevStore";
import { cn } from "@/lib/utils";

const NO_ACTION_VIEWS: PromptActionViewKey[] = ["passingUntilEot", "noAction"];

const PROMPT_TITLES: Partial<Record<string, string>> = {
  chooseAction: "Priority",
  chooseAttackers: "Declare Attackers",
  chooseBlockers: "Declare Blockers",
  chooseBoardTargets: "Choose Targets",
  chooseDamageAssignmentOrder: "Damage Order",
  payManaCost: "Pay Mana",
  mulligan: "Mulligan",
  mulliganPutBack: "Mulligan",
};

export function MainActionOverlay({
  promptType,
  isWaitingForResponse,
  availableAttackerIds,
  pendingAttackers,
  onPassPriority,
  onPassUntilEot,
  selectedAttackDefenderId,
  selectedAttackDefenderLabel,
  multipleAttackDefenders,
  onDeclareAttackers,
  onBeginAttackTargetPick,
  pendingAttacker,
  pendingBlocker,
  blockError,
  blockRequirementError,
  attackerIds,
  blockAssignments,
  onDeclareBlockers,
  damageOrderCount,
  damageOrderTotal,
  onConfirmDamageOrder,
  onUndoDamageOrder,
  onDefaultDamageOrder,
  onOpenStack,
  targetCompletionLabel,
  onCompleteTargets,
  resolveCardName,
  resolveCard,
  isMyTurn,
  step,
  payManaCostInfo,
  onPayManaCost,
  onAutoManaCost,
  onCancelManaCost,
  mulliganCount,
  onMulliganKeep,
  onMulliganDraw,
  mulliganPutBackCount,
  mulliganSelectedCount,
  onMulliganPutBackConfirm,
  selfClusterMaxHeight,
}: MainActionOverlayProps) {
  const promptActionOverride = useGameDevStore((s) => s.promptActionOverride);
  const themeColors = useTheme().gameTheme;
  const [collapsed, setCollapsed] = useState(false);
  const [prevPromptType, setPrevPromptType] = useState(promptType);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);

  if (promptType !== prevPromptType) {
    setPrevPromptType(promptType);
    setCollapsed(false);
  }

  const isNoActionView = promptActionOverride
    ? NO_ACTION_VIEWS.includes(promptActionOverride)
    : !promptType;
  const hasAction = !isNoActionView;
  const title = hasAction ? (PROMPT_TITLES[promptType ?? ""] ?? "Action Required") : null;
  const effectiveCollapsed = hasAction && collapsed;

  const applyHeight = useCallback(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!body || !content) return;
    const target = effectiveCollapsed
      ? (headerRef.current?.offsetHeight ?? 0)
      : content.offsetHeight;
    const from = body.getBoundingClientRect().height;
    animRef.current?.cancel();
    body.style.height = `${target}px`;
    if (!body.isConnected || Math.abs(from - target) < 0.5) return;
    animRef.current = body.animate([{ height: `${from}px` }, { height: `${target}px` }], {
      duration: 160,
      easing: "cubic-bezier(0.33, 1, 0.68, 1)",
    });
  }, [effectiveCollapsed]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    applyHeight();
    const ro = new ResizeObserver(applyHeight);
    ro.observe(content);
    return () => ro.disconnect();
  }, [applyHeight]);

  if (promptType === "gameOver" || !selfClusterMaxHeight || selfClusterMaxHeight <= 0) return null;

  const currentPhaseIndex = PHASES.findIndex((phase) => phase.id === step);
  const passToPhaseShort =
    currentPhaseIndex >= 0
      ? (PHASES[(currentPhaseIndex + 1) % PHASES.length]?.short ?? "NEXT")
      : "NEXT";
  const glow = themeColors.activeAction.priority;

  return (
    <div
      data-action-cluster
      className={cn(
        "absolute bottom-0 right-3 z-40 w-[300px] max-w-[calc(100%-12px)] flex flex-col gap-0 overflow-hidden rounded-t-lg border border-b-0 border-border/70 bg-card/95 shadow-lg backdrop-blur-sm",
        hasAction && "action-overlay-glow",
      )}
      style={
        {
          maxHeight: selfClusterMaxHeight,
          ...(hasAction
            ? {
                "--action-glow-ring": withAlpha(glow, 0.75),
                "--action-glow-soft": withAlpha(glow, 0.3),
                "--action-glow-ring-strong": glow,
                "--action-glow-soft-strong": withAlpha(glow, 0.6),
              }
            : {}),
        } as React.CSSProperties
      }
    >
      <div ref={bodyRef} className="overflow-hidden" style={{ maxHeight: selfClusterMaxHeight }}>
        <div ref={contentRef}>
          {hasAction && title && (
            <div
              ref={headerRef}
              className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-border/70"
            >
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/90 truncate">
                {title}
              </span>
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title={collapsed ? "Expand" : "Collapse"}
                aria-label={collapsed ? "Expand action panel" : "Collapse action panel"}
                aria-expanded={!collapsed}
              >
                {collapsed ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          )}
          <section className="flex w-full flex-col gap-2 px-2 pt-2 pb-2">
            <CombatInfo
              promptType={promptType}
              attackerIds={attackerIds}
              pendingAttackers={pendingAttackers}
              blockAssignments={blockAssignments}
              resolveCardName={resolveCardName}
              resolveCard={resolveCard}
            />
            <div
              className="flex flex-col items-center w-full [&_button]:mx-0"
              onKeyDownCapture={(e) => {
                if (e.code === "Space" && e.target instanceof HTMLButtonElement) {
                  e.preventDefault();
                }
              }}
            >
              <PromptActionController
                promptType={promptType}
                isWaitingForResponse={isWaitingForResponse}
                isMyTurn={isMyTurn}
                passToPhaseShort={passToPhaseShort}
                availableAttackerIds={availableAttackerIds}
                pendingAttackers={pendingAttackers}
                onPassPriority={onPassPriority}
                onPassUntilEot={onPassUntilEot}
                selectedAttackDefenderId={selectedAttackDefenderId}
                selectedAttackDefenderLabel={selectedAttackDefenderLabel}
                multipleAttackDefenders={multipleAttackDefenders}
                onDeclareAttackers={onDeclareAttackers}
                onBeginAttackTargetPick={onBeginAttackTargetPick}
                pendingAttacker={pendingAttacker}
                pendingBlocker={pendingBlocker}
                blockError={blockError}
                blockRequirementError={blockRequirementError}
                blockAssignments={blockAssignments}
                onDeclareBlockers={onDeclareBlockers}
                damageOrderCount={damageOrderCount}
                damageOrderTotal={damageOrderTotal}
                onConfirmDamageOrder={onConfirmDamageOrder}
                onUndoDamageOrder={onUndoDamageOrder}
                onDefaultDamageOrder={onDefaultDamageOrder}
                onOpenStack={onOpenStack}
                targetCompletionLabel={targetCompletionLabel}
                onCompleteTargets={onCompleteTargets}
                payManaCostInfo={payManaCostInfo}
                onPayManaCost={onPayManaCost}
                onAutoManaCost={onAutoManaCost}
                onCancelManaCost={onCancelManaCost}
                mulliganCount={mulliganCount}
                onMulliganKeep={onMulliganKeep}
                onMulliganDraw={onMulliganDraw}
                mulliganPutBackCount={mulliganPutBackCount}
                mulliganSelectedCount={mulliganSelectedCount}
                onMulliganPutBackConfirm={onMulliganPutBackConfirm}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
