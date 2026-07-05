import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { MainActionOverlayProps } from "../game.types";
import { PromptActionController } from "@/components/prompts/PromptActionController";
import { CombatInfo } from "./CombatInfo";
import { getPromptContextLines } from "./promptContextHints";
import { DynamicTextRender } from "../DynamicTextRender";
import { TouchHintPopover } from "../TouchHintPopover";
import { ACTION_DRAWER_BUMP_EVENT, PHASES } from "../game.constants";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { type PromptActionViewKey, useGameDevStore } from "@/stores/useGameDevStore";
import { useIsMobileGame, useIsShortScreen } from "@/hooks/useBreakpoints";
import { useLongPressPreview } from "@/hooks/useLongPressPreview";
import { cn } from "@/lib/utils";

const NO_ACTION_VIEWS: PromptActionViewKey[] = ["noAction"];

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

const BUMP = {
  heightPx: 12,
  durationMs: 280,
  peak: 0.4,
  easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
};

const BUMP_OPTIONS: KeyframeAnimationOptions = {
  duration: BUMP.durationMs,
  easing: BUMP.easing,
};

export function MainActionOverlay({
  promptType,
  isWaitingForResponse,
  isWaitingForOthers,
  availableAttackerIds,
  pendingAttackers,
  onPassPriority,
  selectedAttackDefenderId,
  multipleAttackDefenders,
  attackAssignmentCount,
  mustAttackHint,
  onDeclareAttackers,
  onBeginAttackTargetPick,
  onSubmitAttack,
  pendingAttacker,
  pendingBlocker,
  blockError,
  blockRequirementError,
  blockRestrictionHint,
  attackerIds,
  blockAssignments,
  combatPairings,
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
  dividerY,
  dimmed,
}: MainActionOverlayProps) {
  const promptActionOverride = useGameDevStore((s) => s.promptActionOverride);
  const themeColors = useTheme().gameTheme;
  const [collapsed, setCollapsed] = useState(false);
  const [prevPromptType, setPrevPromptType] = useState(promptType);
  const containerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);
  const bumpRef = useRef<Animation | null>(null);

  if (promptType !== prevPromptType) {
    setPrevPromptType(promptType);
    setCollapsed(false);
  }

  const minimal = useIsMobileGame();
  const [contextRect, setContextRect] = useState<DOMRect | null>(null);
  const contextKey = `${promptType ?? ""}:${minimal}`;
  const [prevContextKey, setPrevContextKey] = useState(contextKey);
  if (contextKey !== prevContextKey) {
    setPrevContextKey(contextKey);
    setContextRect(null);
  }
  const longPress = useLongPressPreview<string>({
    resolve: () =>
      minimal && containerRef.current
        ? { item: promptType ?? "", anchor: containerRef.current }
        : null,
    show: (_item, anchorRect) => setContextRect(anchorRect),
    hide: () => setContextRect(null),
  });

  const isNoActionView = promptActionOverride
    ? NO_ACTION_VIEWS.includes(promptActionOverride)
    : !promptType || isWaitingForOthers;
  const hasAction = !isNoActionView;
  const title = hasAction ? (PROMPT_TITLES[promptType ?? ""] ?? "Action Required") : "Waiting";
  const effectiveCollapsed = !minimal && hasAction && collapsed;
  const isRenderable =
    promptType !== "gameOver" && !!selfClusterMaxHeight && selfClusterMaxHeight > 0;

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
  }, [applyHeight, isRenderable]);

  useEffect(() => {
    const bump = () => {
      const el = containerRef.current;
      if (!el) return;
      const h = el.offsetHeight;
      const scale = h > 0 ? (h + BUMP.heightPx) / h : 1;
      bumpRef.current?.cancel();
      bumpRef.current = el.animate(
        [
          { transform: "scaleY(1)", offset: 0 },
          { transform: `scaleY(${scale})`, offset: BUMP.peak },
          { transform: "scaleY(1)", offset: 1 },
        ],
        BUMP_OPTIONS,
      );
    };
    window.addEventListener(ACTION_DRAWER_BUMP_EVENT, bump);
    return () => window.removeEventListener(ACTION_DRAWER_BUMP_EVENT, bump);
  }, []);

  const compact = useIsShortScreen();

  if (!isRenderable) return null;

  const currentPhaseIndex = PHASES.findIndex((phase) => phase.id === step);
  const passToPhaseShort =
    currentPhaseIndex >= 0
      ? (PHASES[(currentPhaseIndex + 1) % PHASES.length]?.short ?? "NEXT")
      : "NEXT";
  const glow = themeColors.activeAction.priority;

  return (
    <div
      ref={containerRef}
      data-action-cluster
      {...(minimal ? longPress : {})}
      className={cn(
        "absolute z-40 max-w-[calc(100%-12px)] origin-bottom flex flex-col gap-0 overflow-hidden border border-border/70 bg-card/95 shadow-lg backdrop-blur-sm",
        minimal
          ? dividerY != null
            ? "right-1.5 w-auto -translate-y-1/2 rounded-2xl"
            : "bottom-20 right-1.5 w-auto rounded-2xl"
          : compact
            ? "bottom-[7.375rem] right-1.5 w-[14.375rem] rounded-lg"
            : "bottom-0 right-3 w-[18.75rem] rounded-t-lg border-b-0",
        hasAction && "action-overlay-glow",
        minimal && dimmed && "pointer-events-none opacity-0 transition-opacity duration-150",
        minimal && !dimmed && "transition-opacity duration-150",
      )}
      style={
        {
          ...(minimal && dividerY != null ? { top: dividerY } : {}),
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
      <div ref={bodyRef} className="overflow-hidden">
        <div ref={contentRef}>
          {!minimal && (
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
                className={cn(
                  "relative rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0 before:absolute before:-inset-2.5 before:content-['']",
                  !hasAction && "invisible",
                )}
                title={collapsed ? "Expand" : "Collapse"}
                aria-label={collapsed ? "Expand action panel" : "Collapse action panel"}
                aria-expanded={!collapsed}
                tabIndex={hasAction ? 0 : -1}
              >
                {collapsed ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          )}
          <section
            className={cn(
              "flex w-full flex-col",
              minimal ? "gap-1 px-1.5 py-1" : "gap-2 px-2 pt-2 pb-2",
            )}
          >
            {!minimal && (
              <CombatInfo
                promptType={promptType}
                attackerIds={attackerIds}
                pendingAttackers={pendingAttackers}
                blockAssignments={blockAssignments}
                combatPairings={combatPairings}
                resolveCardName={resolveCardName}
                resolveCard={resolveCard}
              />
            )}
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
                isWaitingForOthers={isWaitingForOthers}
                isMyTurn={isMyTurn}
                passToPhaseShort={passToPhaseShort}
                availableAttackerIds={availableAttackerIds}
                pendingAttackers={pendingAttackers}
                onPassPriority={onPassPriority}
                selectedAttackDefenderId={selectedAttackDefenderId}
                multipleAttackDefenders={multipleAttackDefenders}
                attackAssignmentCount={attackAssignmentCount}
                mustAttackHint={mustAttackHint}
                onDeclareAttackers={onDeclareAttackers}
                onBeginAttackTargetPick={onBeginAttackTargetPick}
                onSubmitAttack={onSubmitAttack}
                pendingAttacker={pendingAttacker}
                pendingBlocker={pendingBlocker}
                blockError={blockError}
                blockRequirementError={blockRequirementError}
                blockRestrictionHint={blockRestrictionHint}
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
      {minimal && contextRect && (
        <TouchHintPopover anchorRect={contextRect}>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/90">
            {title}
          </p>
          {getPromptContextLines(promptType, {
            mulliganCount,
            mustAttackHint,
            blockRestrictionHint,
            payManaCostInfo,
            mulliganPutBackCount,
            mulliganSelectedCount,
          }).map((line) => (
            <p key={line} className="text-[11px] text-muted-foreground">
              <DynamicTextRender className="align-middle" text={line} />
            </p>
          ))}
          <CombatInfo
            promptType={promptType}
            attackerIds={attackerIds}
            pendingAttackers={pendingAttackers}
            blockAssignments={blockAssignments}
            combatPairings={combatPairings}
            resolveCardName={resolveCardName}
            resolveCard={resolveCard}
          />
        </TouchHintPopover>
      )}
    </div>
  );
}
