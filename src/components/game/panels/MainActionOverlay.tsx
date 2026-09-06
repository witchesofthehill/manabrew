import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Hand, Zap } from "lucide-react";
import type { MainActionOverlayProps } from "../game.types";
import { PromptActionController } from "@/components/prompts/PromptActionController";
import { CombatInfo } from "./CombatInfo";
import { getPromptContextLines } from "./promptContextHints";
import { DynamicTextRender } from "../DynamicTextRender";
import { TouchHintPopover } from "../TouchHintPopover";
import {
  ACTION_CLUSTER_PREFERRED_HEIGHT_PX,
  ACTION_DRAWER_BUMP_EVENT,
  PHASES,
} from "../game.constants";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { type PromptActionViewKey, useGameDevStore } from "@/stores/useGameDevStore";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { useKeybindingsStore, resolveCombo } from "@/stores/useKeybindingsStore";
import { formatCombo } from "@/lib/keybindings";
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

function promptTypeForView(
  promptType: MainActionOverlayProps["promptType"],
  override: PromptActionViewKey | null,
): MainActionOverlayProps["promptType"] {
  if (!override) return promptType;
  if (override === "chooseTargetSpell" || override === "promptLabel") return "chooseBoardTargets";
  if (override === "chooseDamageOrder") return "chooseDamageAssignmentOrder";
  if (override === "promptRequired" || override === "noAction") return undefined;
  return override;
}

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

function PriorityModePill() {
  const fullControl = usePromptPreferencesStore((s) => s.fullControl);
  const setFullControl = usePromptPreferencesStore((s) => s.setFullControl);
  const keyOverrides = useKeybindingsStore((s) => s.overrides);
  const toggleCombo = resolveCombo("toggle-priority-mode", keyOverrides);
  const hint = toggleCombo ? ` (${formatCombo(toggleCombo)})` : "";
  const Icon = fullControl ? Hand : Zap;
  return (
    <button
      type="button"
      onClick={() => setFullControl(!fullControl)}
      aria-pressed={fullControl}
      title={
        fullControl
          ? `Full control — you stop at every priority window${hint}`
          : `Autopass: dead priority windows pass automatically${hint}`
      }
      className={cn(
        "relative z-10 flex h-[22px] shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 text-[9px] leading-none font-bold tracking-[0.12em] shadow-sm transition-[color,background-color,border-color,transform] active:translate-y-px",
        fullControl
          ? "border-white/30 bg-white/15 text-foreground hover:bg-white/20"
          : "border-border/60 bg-white/5 text-muted-foreground hover:border-border hover:bg-white/10 hover:text-foreground",
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {fullControl ? "FULL CTRL" : "AUTOPASS"}
    </button>
  );
}

export function MainActionOverlay({
  promptType,
  isWaitingForResponse,
  isWaitingForOthers,
  availableAttackerIds,
  pendingAttackers,
  onPassPriority,
  onPassEndTurn,
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
  combatDefenderLife,
  onDeclareBlockers,
  damageOrderCount,
  damageOrderTotal,
  onConfirmDamageOrder,
  onUndoDamageOrder,
  onDefaultDamageOrder,
  onOpenStack,
  targetCompletionLabel,
  targetCompletionKind,
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
  const effectivePromptType = promptTypeForView(promptType, promptActionOverride);
  const showPriorityMode = promptActionOverride
    ? promptActionOverride === "chooseAction" || promptActionOverride === "noAction"
    : isNoActionView || promptType === "chooseAction";
  const hasAction = !isNoActionView;
  const title = hasAction
    ? (PROMPT_TITLES[effectivePromptType ?? ""] ?? "Action Required")
    : "Waiting";
  const contextLines = getPromptContextLines(effectivePromptType, {
    mulliganCount,
    mustAttackHint,
    blockRestrictionHint,
    payManaCostInfo,
    mulliganPutBackCount,
    mulliganSelectedCount,
  });
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
  const awaitingTarget = effectivePromptType === "chooseAttackers" && pendingAttackers.length > 0;
  const glow = awaitingTarget
    ? themeColors.promptAction.attackAction
    : themeColors.activeAction.priority;

  return (
    <div
      ref={containerRef}
      data-action-cluster
      {...(minimal ? longPress : {})}
      className={cn(
        "absolute z-40 max-w-[calc(100%-12px)] origin-bottom flex flex-col gap-0 overflow-hidden border border-border/70 bg-card shadow-lg",
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
          ...(!minimal
            ? {
                minHeight: Math.min(ACTION_CLUSTER_PREFERRED_HEIGHT_PX, selfClusterMaxHeight ?? 0),
              }
            : {}),
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
              className={cn(
                "flex items-center justify-between gap-2 border-b px-2.5 py-2",
                hasAction
                  ? "border-active-action-priority/35 bg-active-action-priority/10"
                  : "border-border/70",
              )}
            >
              <span className="flex min-w-0 items-center gap-2 text-[13px] font-bold uppercase tracking-[0.12em] text-foreground">
                {hasAction && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-active-action-priority"
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">{title}</span>
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {showPriorityMode && <PriorityModePill />}
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => !c)}
                  className={cn(
                    "relative shrink-0 rounded p-0.5 text-muted-foreground transition-colors before:absolute before:-inset-2.5 before:content-[''] hover:text-foreground",
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
            </div>
          )}
          <section
            className={cn(
              "flex w-full flex-col",
              minimal ? "gap-1 px-1.5 py-1" : "gap-2 px-2 pt-2 pb-2",
            )}
          >
            {!minimal && hasAction && contextLines.length > 0 && (
              <div className="w-full rounded-md border border-active-action-priority/25 bg-active-action-priority/5 px-2.5 py-2">
                {contextLines.map((line) => (
                  <p key={line} className="text-xs font-medium leading-snug text-foreground/90">
                    <DynamicTextRender className="align-middle" text={line} />
                  </p>
                ))}
              </div>
            )}
            {!minimal && (
              <CombatInfo
                promptType={promptType}
                attackerIds={attackerIds}
                pendingAttackers={pendingAttackers}
                blockAssignments={blockAssignments}
                combatPairings={combatPairings}
                resolveCardName={resolveCardName}
                resolveCard={resolveCard}
                defenderLife={combatDefenderLife}
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
                onPassEndTurn={onPassEndTurn}
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
                targetCompletionKind={targetCompletionKind}
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
          {contextLines.map((line) => (
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
            defenderLife={combatDefenderLife}
          />
        </TouchHintPopover>
      )}
    </div>
  );
}
