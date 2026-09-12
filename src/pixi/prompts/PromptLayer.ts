import { topModal } from "@/lib/modalStack";
import { summarizeCombat } from "@/components/game/combatSummary";
import {
  Application,
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  type Ticker,
} from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { CardSprite } from "@/pixi/CardSprite";
import {
  ACTION_DRAWER_BUMP_EVENT,
  AUTOPASS_DELAY_MAX_MS,
  AUTOPASS_DELAY_MIN_MS,
} from "@/components/game/game.constants";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { type PromptActionViewKey, useGameDevStore } from "@/stores/useGameDevStore";
import { resolveCombo, useKeybindingsStore } from "@/stores/useKeybindingsStore";
import { comboSymbols, formatCombo, normalizeCombo } from "@/lib/keybindings";
import { isCoarsePointer } from "@/lib/responsive";
import {
  ATTACK_DRAG_HINT,
  getPromptContextLines,
} from "@/components/game/panels/promptContextHints";
import type { CardDto } from "@/protocol";
import { PromptButton } from "./PromptButton";
import { PromptGlow } from "./PromptGlow";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
import type { PromptLayerCallbacks, PromptOverlaySpec } from "./prompt.types";
import {
  type ActionViewLayout,
  FILTER_CARET_PERIOD_MS,
  MODAL_TYPES,
  type WaitingHourglassVisual,
  actionTitle,
  actionViewKey,
  isAutopassWindow,
  promptRichText,
  promptText,
  promptTypeForView,
  sameGameOverPresentation,
  samePromptPresentation,
} from "./PromptLayerBase";
import { PromptModalLayer } from "./PromptModalLayer";

export class PromptLayer extends PromptModalLayer {
  private readonly unsubscribePromptPreferences: () => void;
  private readonly unsubscribePreferences: () => void;
  private readonly unsubscribeKeybindings: () => void;
  private keyListener: (event: KeyboardEvent) => void;
  private onStageMove = (event: FederatedPointerEvent): void => this.moveDrag(event);
  private onStageUp = (event: FederatedPointerEvent): void => this.finishDrag(event);
  private onStageCancel = (event: FederatedPointerEvent): void => this.cancelPointerDrag(event);
  private onModifierEvent = (event: KeyboardEvent | PointerEvent): void =>
    this.updateEndTurnModifiers(event);
  private onModifierReset = (): void => {
    this.setEndTurnModifiersHeld(false);
    this.setSelectionFilterFocused(false);
  };
  private onActionBump = (event: Event): void =>
    this.bumpActionPanel((event as CustomEvent<boolean>).detail === true);
  private readonly onTick = (ticker: Ticker): void => this.update(ticker.deltaMS);

  constructor(app: Application, callbacks: PromptLayerCallbacks = {}) {
    super(app, callbacks);
    this.app.stage.on("globalpointermove", this.onStageMove);
    this.app.stage.on("pointerup", this.onStageUp);
    this.app.stage.on("pointerupoutside", this.onStageUp);
    this.app.stage.on("pointercancel", this.onStageCancel);
    this.app.ticker.add(this.onTick);
    this.keyListener = (event) => this.handleKey(event);
    window.addEventListener("keydown", this.keyListener);
    window.addEventListener("keydown", this.onModifierEvent);
    window.addEventListener("keyup", this.onModifierEvent);
    window.addEventListener("pointermove", this.onModifierEvent);
    window.addEventListener("pointerdown", this.onModifierEvent);
    window.addEventListener("blur", this.onModifierReset);
    document.addEventListener("visibilitychange", this.onModifierReset);
    window.addEventListener(ACTION_DRAWER_BUMP_EVENT, this.onActionBump);
    this.unsubscribePromptPreferences = usePromptPreferencesStore.subscribe((state, previous) => {
      if (state.fullControl === previous.fullControl) return;
      this.resetAutopassState();
      this.rebuild();
    });
    this.unsubscribePreferences = usePreferencesStore.subscribe((state, previous) => {
      if (state.promptCardStyle === previous.promptCardStyle) return;
      this.promptCardStates.clear();
      this.rebuild();
    });
    this.unsubscribeKeybindings = useKeybindingsStore.subscribe(() => this.rebuild());
  }
  setTheme(theme: Theme): void {
    this.theme = theme;
    this.rebuild();
  }

  setViewport(width: number, height: number): void {
    if (width === this.viewportWidth && height === this.viewportHeight) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.rebuild();
  }

  setSpec(spec: PromptOverlaySpec | null): void {
    const previousSpec = this.spec;
    const hadPriority =
      previousSpec?.action.promptType === "chooseAction" &&
      !previousSpec.action.isWaitingForResponse &&
      !previousSpec.action.isWaitingForOthers;
    const hasPriority =
      spec?.action.promptType === "chooseAction" &&
      !spec.action.isWaitingForResponse &&
      !spec.action.isWaitingForOthers;
    const nextActionPromptType = spec?.action.promptType;
    if (nextActionPromptType !== this.actionPromptType) {
      this.actionPromptType = nextActionPromptType;
      this.actionContextOpen = false;
    }
    const promptChanged =
      previousSpec?.currentPrompt !== spec?.currentPrompt ||
      !sameGameOverPresentation(previousSpec?.gameOver, spec?.gameOver);
    const overrideChanged =
      previousSpec?.action.promptActionOverride !== spec?.action.promptActionOverride;
    const presentationChanged = promptChanged || !samePromptPresentation(previousSpec, spec);
    if (promptChanged) {
      this.resetLocalState(spec);
      if (spec?.currentPrompt && MODAL_TYPES.has(spec.currentPrompt.input.type)) {
        spec.onShowModal();
      }
    }
    this.spec = spec;
    if (!promptChanged && overrideChanged) this.resetAutopassState();
    const modalUnavailable = !!spec?.modalHidden || !!spec?.action.isWaitingForResponse;
    if (modalUnavailable) this.selectionFilterFocused = false;
    if (this.drag && !promptChanged && !modalUnavailable) return;
    if (!presentationChanged) return;
    this.rebuild();
    if (hasPriority && (promptChanged || !hadPriority)) this.flashActionGlow();
  }

  get blocksBoard(): boolean {
    return this.modalOpen;
  }

  hitTest(x: number, y: number): boolean {
    if (!this.container.visible) return false;
    if (this.modalOpen) return true;
    return this.actionBounds?.contains(x, y) ?? false;
  }

  getActionBounds(): Rectangle | null {
    return this.actionBounds?.clone() ?? null;
  }

  get compactAction(): boolean {
    return this.viewportHeight <= 520 && isCoarsePointer();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.keyListener);
    window.removeEventListener("keydown", this.onModifierEvent);
    window.removeEventListener("keyup", this.onModifierEvent);
    window.removeEventListener("pointermove", this.onModifierEvent);
    window.removeEventListener("pointerdown", this.onModifierEvent);
    window.removeEventListener("blur", this.onModifierReset);
    document.removeEventListener("visibilitychange", this.onModifierReset);
    window.removeEventListener(ACTION_DRAWER_BUMP_EVENT, this.onActionBump);
    this.app.stage.off("globalpointermove", this.onStageMove);
    this.app.stage.off("pointerup", this.onStageUp);
    this.unsubscribePromptPreferences();
    this.unsubscribePreferences();
    this.unsubscribeKeybindings();
    this.app.stage.off("pointerupoutside", this.onStageUp);
    this.app.stage.off("pointercancel", this.onStageCancel);
    this.app.ticker.remove(this.onTick);
    this.actionLongPress.reset();
    this.callbacks.onReferenceChange?.(null);
    this.cancelDrag();
    this.entranceTween?.kill();
    this.stopRollAnimation();
    if (this.rollHighlightText) gsap.killTweensOf(this.rollHighlightText);
    this.clearScryCardTiles();
    this.actionGlowTween?.kill();
    this.stopWaitingAnimation();
    gsap.killTweensOf(this.actionFeedback);
    this.clearReorderCardVisuals();
    this.container.destroy({ children: true });
  }

  private resetLocalState(spec: PromptOverlaySpec | null): void {
    this.promptCardStates.clear();
    this.activePromptCard = null;
    this.activePromptCardId = null;
    this.selectedIds.clear();
    this.counts.clear();
    this.selectionFilter = "";
    this.selectionFilterFocused = false;
    this.order = [];
    this.autopassRemainingMs = null;
    this.autopassTotalMs = 0;
    this.scryItems = {};
    this.scrySelectedId = null;
    this.damageAssigned = {};
    this.cancelDrag();
    this.dropZones = [];
    this.clearScryCardTiles();
    this.scryPreviousPositions.clear();
    this.clearReorderCardVisuals();
    this.reorderPreviousPositions.clear();
    this.reorderPreview = null;
    if (this.rollHighlightText) gsap.killTweensOf(this.rollHighlightText);
    this.stopRollAnimation();
    this.rollVisuals = [];
    this.rollHighlightText = null;
    this.rollConfirm = null;
    this.rollSettled = false;
    this.rollElapsedMs = 0;
    this.modalScrollOffset = 0;
    this.modalScrollMax = 0;
    this.scryPoolScrollOffset = 0;
    this.scryPoolScrollMax = 0;
    this.scryPoolScrollToEnd = false;
    const input = spec?.currentPrompt?.input;
    if (!input) return;
    if (input.type === "chooseNumber") {
      this.numberValue = input.min;
      this.numberBuffer = String(input.min);
    }
    if (input.type === "reorder") this.order = input.items.map((item) => item.id);
    if (input.type === "scry") {
      this.scryItems = {
        pool: input.cards.map((card) => card.id),
        ...Object.fromEntries(input.zones.map((_, index) => [`zone-${index}`, []])),
      };
    }
    if (isAutopassWindow(spec)) {
      this.autopassTotalMs =
        AUTOPASS_DELAY_MIN_MS + Math.random() * (AUTOPASS_DELAY_MAX_MS - AUTOPASS_DELAY_MIN_MS);
      this.autopassRemainingMs = this.autopassTotalMs;
    }
  }
  protected rebuild(): void {
    this.stopWaitingAnimation();
    this.activePromptCard = null;
    this.callbacks.onReferenceChange?.(null);
    this.cancelDrag();
    this.selectionFilterView = null;
    if (this.rollHighlightText) gsap.killTweensOf(this.rollHighlightText);
    this.stopRollAnimation();
    this.dropZones = [];
    this.clearScryCardTiles();
    this.clearReorderCardVisuals();
    this.actionBounds = null;
    this.autopassFill = null;
    this.priorityButtons = null;
    this.actionGlow = null;
    this.actionPulseNodes = [];
    this.modalOpen = false;
    this.modalBody = null;
    this.container.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (!this.spec || this.viewportWidth <= 0 || this.viewportHeight <= 0) {
      this.container.visible = false;
      this.presentPrompt(null);
      return;
    }
    this.container.visible = true;
    if (this.spec.gameOver) {
      this.modalOpen = true;
      this.renderGameOver();
      this.presentPrompt(this.spec.gameOver);
      return;
    }
    const input = this.spec.currentPrompt?.input;
    if (
      input &&
      MODAL_TYPES.has(input.type) &&
      !this.spec.modalHidden &&
      !this.spec.action.isWaitingForResponse
    ) {
      this.modalOpen = true;
      this.renderModal();
      this.presentPrompt(this.spec.currentPrompt);
      return;
    }
    this.renderActionPanel();
    this.syncActionFeedback(performance.now());
    this.presentPrompt("action");
  }

  private presentPrompt(key: object | string | null): void {
    if (key === this.entranceKey) return;
    this.entranceKey = key;
    this.entranceTween?.kill();
    this.entranceTween = null;
    this.container.alpha = 1;
    if (key === null || !animationsEnabled()) return;
    this.entranceTween = gsap.fromTo(
      this.container,
      { alpha: 0 },
      {
        alpha: 1,
        duration: this.spec?.gameOver ? 0.28 : 0.18,
        ease: "power2.out",
        onComplete: () => {
          this.entranceTween = null;
        },
      },
    );
  }

  private renderActionPanel(): void {
    const spec = this.spec!;
    const action = spec.action;
    const shortScreen = this.viewportHeight <= 520;
    const touch = isCoarsePointer();
    const minimal = shortScreen && touch;
    if (
      action.promptType === "gameOver" ||
      !action.selfClusterMaxHeight ||
      action.selfClusterMaxHeight <= 0
    ) {
      this.container.visible = false;
      return;
    }

    const viewKey = actionViewKey(action);
    const effectivePromptType = promptTypeForView(action.promptType, action.promptActionOverride);
    const preview = action.promptActionOverride != null;
    const isNoActionView = viewKey === "noAction";
    const hasAction = !isNoActionView;
    const showPriorityMode = action.promptActionOverride
      ? viewKey === "chooseAction" || viewKey === "noAction"
      : isNoActionView || action.promptType === "chooseAction";
    const fixedWidth = minimal ? null : shortScreen ? 230 : 300;
    const fixedContentWidth = fixedWidth == null ? this.viewportWidth - 24 : fixedWidth - 16;
    const menu = minimal ? this.makeActionMenuButton(true) : null;
    const viewAvailableWidth = fixedContentWidth - (menu ? menu.width + 4 : 0);
    const view = this.buildActionView(viewKey, viewAvailableWidth, minimal, touch, preview);
    const combat = minimal ? null : this.buildActionCombatInfo(fixedContentWidth);
    const rowWidth = view.width + (menu ? 4 + menu.width : 0);
    const contentWidth =
      fixedWidth == null ? Math.max(rowWidth, combat?.width ?? 0) : fixedContentWidth;
    const width = fixedWidth ?? Math.min(this.viewportWidth - 12, Math.max(40, contentWidth + 12));
    const headerHeight = minimal ? 0 : 34;
    const sectionPaddingX = minimal ? 6 : 8;
    const sectionPaddingTop = minimal ? 4 : 8;
    const sectionPaddingBottom = minimal ? 4 : 8;
    const contentGap = combat ? 8 : 0;
    const viewHeight = Math.max(view.height, menu?.height ?? 0);
    const bodyHeight =
      sectionPaddingTop + (combat?.height ?? 0) + contentGap + viewHeight + sectionPaddingBottom;
    const panelHeight = headerHeight + bodyHeight;
    const x = this.viewportWidth - width - (minimal || shortScreen ? 6 : 12);
    const unclampedY =
      minimal && action.dividerY != null
        ? action.dividerY - panelHeight / 2
        : minimal
          ? this.viewportHeight - panelHeight - 80
          : shortScreen
            ? this.viewportHeight - panelHeight - 118
            : this.viewportHeight - panelHeight;
    const y = minimal
      ? Math.max(6, Math.min(this.viewportHeight - panelHeight - 6, unclampedY))
      : unclampedY;
    const radius = minimal ? 16 : 8;
    const squareBottom = !minimal && !shortScreen;
    const panel = new Container();
    panel.position.set(x, y + panelHeight);
    panel.pivot.set(0, panelHeight);
    panel.eventMode = "static";
    panel.hitArea = new Rectangle(0, 0, width, panelHeight);
    panel.accessible = true;
    panel.accessibleTitle = hasAction ? actionTitle(effectivePromptType) : "Waiting";
    panel.tabIndex = -1;

    if (hasAction) {
      const glowColor =
        effectivePromptType === "chooseAttackers" && action.pendingAttackers.length > 0
          ? this.theme.gameTheme.promptAction.attackAction
          : this.theme.appTheme.primary;
      this.actionGlow = new PromptGlow({
        width,
        height: panelHeight,
        radius,
        squareBottom,
        color: hexToNum(glowColor),
        highlight: hexToNum(this.theme.appTheme.foreground),
      });
    }

    const background = this.makeActionPanelSurface(width, panelHeight, radius, squareBottom);
    panel.addChild(background);
    if (this.actionGlow) panel.addChild(this.actionGlow);

    if (!minimal) {
      let right = width - 8;
      const menuButton = this.makeActionMenuButton(false);
      menuButton.container.position.set(right - menuButton.width, 8);
      panel.addChild(menuButton.container);
      right -= menuButton.width + 5;
      if (showPriorityMode) {
        const mode = this.makePriorityModePill(preview);
        mode.position.set(right - mode.buttonWidth, 6);
        panel.addChild(mode);
        right -= mode.buttonWidth + 6;
      }
      const title = promptText(
        (hasAction ? actionTitle(effectivePromptType) : "Waiting").toUpperCase(),
        11,
        this.theme.appTheme.foreground,
        {
          weight: "700",
          width: Math.max(20, right - 8),
          letterSpacing: 1.32,
          truncate: true,
        },
      );
      title.position.set(8, 9);
      title.alpha = 0.9;
      panel.addChild(title);
      panel.addChild(
        new Graphics()
          .rect(0, headerHeight - 1, width, 1)
          .fill({ color: hexToNum(this.theme.appTheme.border), alpha: 0.7 }),
      );
    }

    let contentY = headerHeight + sectionPaddingTop;
    if (menu) {
      view.container.position.set(sectionPaddingX, contentY + (viewHeight - view.height) / 2);
      menu.container.position.set(
        sectionPaddingX + view.width + 4,
        contentY + (viewHeight - menu.height) / 2,
      );
      panel.addChild(view.container, menu.container);
    } else {
      view.container.position.set(
        sectionPaddingX + Math.max(0, (contentWidth - view.width) / 2),
        contentY,
      );
      panel.addChild(view.container);
    }
    contentY += viewHeight + contentGap;
    if (combat) {
      combat.container.position.set(sectionPaddingX, contentY);
      panel.addChild(combat.container);
    }

    if (minimal) {
      panel.on("pointerdown", (event: FederatedPointerEvent) => {
        this.actionLongPress.start(event, "action-panel", () => {
          this.actionContextOpen = true;
          this.renderActionContextPopover(
            x,
            y,
            width,
            hasAction ? actionTitle(effectivePromptType) : "Waiting",
          );
        });
      });
      panel.on("globalpointermove", (event: FederatedPointerEvent) => {
        this.actionLongPress.move(event.global.x, event.global.y);
      });
      const finish = () => {
        this.actionLongPress.cancel();
        if (!this.actionContextOpen) {
          this.actionLongPress.releaseFired();
          return;
        }
        this.actionContextOpen = false;
        this.actionLongPress.releaseFired();
        this.rebuild();
      };
      panel.on("pointerup", finish);
      panel.on("pointerupoutside", finish);
      panel.on("pointertapcapture", (event: FederatedPointerEvent) => {
        if (this.actionLongPress.consumeTap("action-panel")) event.stopImmediatePropagation();
      });
    }

    this.container.addChild(panel);
    this.actionBounds = new Rectangle(x, y, width, panelHeight);
    if (minimal && action.dimmed) this.container.visible = false;
  }

  private buildActionView(
    viewKey: PromptActionViewKey,
    availableWidth: number,
    minimal: boolean,
    touch: boolean,
    preview: boolean,
  ): ActionViewLayout {
    const action = this.spec!.action;
    const disabled = action.isWaitingForResponse || action.isWaitingForOthers || preview;
    const attackColor = this.theme.gameTheme.promptAction.attackAction;
    const muted = this.theme.appTheme["muted-foreground"];

    switch (viewKey) {
      case "chooseAction":
        return this.buildChooseActionView(availableWidth, minimal, disabled);
      case "chooseAttackers": {
        const container = new Container();
        let y = 0;
        let width = 0;
        if (!minimal && action.mustAttackHint) {
          const text = promptText(action.mustAttackHint, 11, muted, {
            weight: "500",
            width: availableWidth,
            align: "center",
          });
          text.anchor.set(0.5, 0);
          text.position.set(availableWidth / 2, y);
          container.addChild(text);
          y += text.height + 6;
          width = availableWidth;
        }
        if (!minimal) {
          const pending = action.pendingAttackers.length > 0;
          const hint = promptText(
            pending ? "Pick a target — click an opponent or planeswalker" : ATTACK_DRAG_HINT,
            11,
            pending ? this.theme.appTheme.foreground : muted,
            {
              weight: pending ? "700" : "400",
              width: availableWidth,
              align: "center",
            },
          );
          hint.anchor.set(0.5, 0);
          hint.position.set(availableWidth / 2 + (pending ? 9 : 0), y);
          container.addChild(hint);
          if (pending) {
            const hintWidth = Math.min(hint.width, availableWidth - 24);
            const crosshair = this.makeIcon("lucide-crosshair", 14, this.theme.appTheme.foreground);
            crosshair.position.set(availableWidth / 2 - hintWidth / 2 - 1, y + 7);
            container.addChild(crosshair);
            this.actionPulseNodes.push(
              { node: hint, maxAlpha: 1 },
              { node: crosshair, maxAlpha: 1 },
            );
          } else {
            hint.alpha = 0.7;
          }
          y += hint.height + 6;
          width = availableWidth;
        }
        const attackCount = action.attackAssignmentCount + action.pendingAttackers.length;
        const attackAll = action.multipleAttackDefenders
          ? () => action.onBeginAttackTargetPick(action.availableAttackerIds)
          : () =>
              action.onDeclareAttackers(
                action.availableAttackerIds,
                action.selectedAttackDefenderId ?? undefined,
              );
        const buttons = [
          this.makeActionButton(
            "Attack All",
            "lucide-swords",
            attackAll,
            "attackAction",
            disabled,
            minimal,
            touch,
          ),
          this.makeActionButton(
            !minimal && attackCount > 0 ? `Attack (${attackCount})` : "Attack",
            "lucide-sword",
            action.onSubmitAttack,
            "attackAction",
            disabled || attackCount === 0,
            minimal,
            touch,
            { badge: minimal && attackCount > 0 ? String(attackCount) : undefined },
          ),
          this.makeActionButton(
            "Pass",
            "lucide-ban",
            action.onPassPriority,
            "priority",
            disabled,
            minimal,
            touch,
          ),
        ];
        const row = this.layoutActionRow(buttons, 6);
        row.container.position.set(minimal ? 0 : Math.max(0, (availableWidth - row.width) / 2), y);
        container.addChild(row.container);
        return {
          container,
          width: Math.max(width, minimal ? row.width : availableWidth),
          height: y + row.height,
        };
      }
      case "chooseBlockers": {
        const container = new Container();
        let y = 0;
        let width = 0;
        const error = action.blockError ?? action.blockRequirementError;
        const hint = action.pendingAttacker
          ? "Attacker selected — click your blocker."
          : action.pendingBlocker
            ? "Blocker selected — click the attacker to block."
            : null;
        if (error) {
          const shown = minimal && error.length > 42 ? `${error.slice(0, 41).trimEnd()}…` : error;
          const textWidth = minimal ? Math.min(192, availableWidth) : availableWidth;
          const text = promptText(shown, minimal ? 10 : 12, attackColor, {
            weight: "600",
            width: textWidth,
            align: "center",
            truncate: minimal,
          });
          text.anchor.set(0.5, 0);
          text.position.set(textWidth / 2, y);
          container.addChild(text);
          y += text.height + 6;
          width = textWidth;
        }
        if (!minimal && hint) {
          const text = promptText(hint, 11, muted, {
            style: "italic",
            width: availableWidth,
            align: "center",
          });
          text.anchor.set(0.5, 0);
          text.position.set(availableWidth / 2, y);
          container.addChild(text);
          y += text.height + 6;
          width = availableWidth;
        } else if (!minimal && !error && action.blockRestrictionHint) {
          const text = promptText(action.blockRestrictionHint, 11, muted, {
            weight: "500",
            width: availableWidth,
            align: "center",
          });
          text.anchor.set(0.5, 0);
          text.position.set(availableWidth / 2, y);
          container.addChild(text);
          y += text.height + 6;
          width = availableWidth;
        }
        const buttons: PromptButton[] = [];
        if (action.blockAssignments.length > 0) {
          buttons.push(
            this.makeActionButton(
              `Block ${action.blockAssignments.length}`,
              "lucide-shield",
              () => action.onDeclareBlockers(action.blockAssignments),
              "defenseAction",
              disabled || !!action.blockRequirementError,
              minimal,
              touch,
              {
                badge: minimal ? String(action.blockAssignments.length) : undefined,
              },
            ),
          );
        }
        buttons.push(
          this.makeActionButton(
            "No Blocks",
            "lucide-ban",
            action.onPassPriority,
            "cancel",
            disabled,
            minimal,
            touch,
          ),
        );
        const row = this.layoutActionRow(buttons, 6);
        const finalWidth = Math.max(width, row.width);
        row.container.position.set(
          minimal ? (finalWidth - row.width) / 2 : Math.max(0, (availableWidth - row.width) / 2),
          y,
        );
        container.addChild(row.container);
        return {
          container,
          width: minimal ? finalWidth : availableWidth,
          height: y + row.height,
        };
      }
      case "chooseDamageOrder": {
        const width = Math.max(120, availableWidth * 0.6);
        const container = new Container();
        const complete =
          action.damageOrderCount >= action.damageOrderTotal && action.damageOrderTotal > 0;
        const instruction = promptText(
          action.damageOrderCount === 0
            ? "Click blockers in the order damage is dealt."
            : complete
              ? "Order set — confirm to deal damage."
              : `Click the next blocker (${action.damageOrderCount}/${action.damageOrderTotal}).`,
          12,
          muted,
          { style: "italic", width, align: "center" },
        );
        instruction.anchor.set(0.5, 0);
        instruction.position.set(width / 2, 0);
        container.addChild(instruction);
        let y = instruction.height + 6;
        const controls = [
          this.makeButton("AUTO", action.onDefaultDamageOrder, {
            action: "attackAction",
            flat: true,
            shadow: true,
            radius: 8,
            disabled,
            width: action.damageOrderCount > 0 ? (width - 6) / 2 : width,
            height: 36,
            fontSize: 12,
            fontWeight: "700",
          }),
        ];
        if (action.damageOrderCount > 0) {
          controls.push(
            this.makeButton("UNDO", action.onUndoDamageOrder, {
              action: "attackAction",
              flat: true,
              shadow: true,
              radius: 8,
              disabled,
              width: (width - 6) / 2,
              height: 36,
              fontSize: 12,
              fontWeight: "700",
            }),
          );
        }
        const row = this.layoutActionRow(controls, 6);
        row.container.position.set(0, y);
        container.addChild(row.container);
        y += row.height;
        if (complete) {
          y += 6;
          const confirm = this.makeButton("CONFIRM ORDER", action.onConfirmDamageOrder, {
            action: "attackAction",
            flat: true,
            shadow: true,
            radius: 8,
            disabled,
            width,
            height: 36,
            icon: "lucide-swords",
            iconSize: 14,
            fontSize: 14,
            fontWeight: "900",
            letterSpacing: 1.68,
          });
          confirm.position.set(0, y);
          container.addChild(confirm);
          y += confirm.buttonHeight;
        }
        return { container, width, height: y };
      }
      case "chooseTargetSpell": {
        const buttons = [
          this.makeActionButton(
            "View Stack",
            "lucide-layers",
            action.onOpenStack,
            "priority",
            disabled,
            minimal,
            touch,
            { title: "Click a glowing spell on the stack to counter it" },
          ),
        ];
        if (action.onCompleteTargets) {
          const cancel = action.targetCompletionKind === "cancel";
          buttons.push(
            this.makeActionButton(
              action.targetCompletionLabel ?? "Done",
              cancel ? "lucide-ban" : "lucide-check",
              action.onCompleteTargets,
              cancel ? "cancel" : "priority",
              disabled,
              minimal,
              touch,
            ),
          );
        }
        return this.layoutActionRow(buttons, 6);
      }
      case "promptLabel":
        return this.buildPromptLabelView(availableWidth, minimal, touch, disabled);
      case "promptRequired": {
        const hidden = this.spec!.modalHidden;
        const button = this.makeButton(
          minimal ? "PROMPT" : hidden ? "PROMPT REQUIRED" : "PROMPT OPEN",
          this.spec!.onShowModal,
          {
            title: hidden ? "Prompt required. Click to reopen." : "Prompt is open.",
            action: "cancel",
            flat: true,
            radius: minimal ? 20 : 8,
            shadow: true,
            disabled,
            width: minimal ? undefined : 200,
            height: minimal ? 40 : 36,
            paddingX: minimal ? 12 : 12,
            icon: "lucide-alert-circle",
            iconSize: 14,
            fontSize: minimal ? 12 : 14,
            fontWeight: "900",
            letterSpacing: minimal ? 0.72 : 0.84,
          },
        );
        if (hidden) this.actionPulseNodes.push({ node: button, maxAlpha: 1 });
        return { container: button, width: button.buttonWidth, height: button.buttonHeight };
      }
      case "payManaCost":
        return this.buildPayManaView(availableWidth, minimal, touch, disabled);
      case "mulligan": {
        if (minimal) {
          return this.layoutActionRow(
            [
              this.makeActionButton(
                "Keep",
                "lucide-check",
                action.onMulliganKeep,
                "priority",
                disabled,
                true,
                touch,
              ),
              this.makeActionButton(
                "Mulligan",
                "lucide-rotate-cw",
                action.onMulliganDraw,
                "secondary",
                disabled,
                true,
                touch,
                {
                  badge: (action.mulliganCount ?? 0) > 0 ? String(action.mulliganCount) : undefined,
                },
              ),
            ],
            6,
          );
        }
        const width = availableWidth;
        const mulliganCount = action.mulliganCount ?? 0;
        const status = promptText(
          mulliganCount > 0
            ? `MULLIGAN ${mulliganCount} · KEEPING PUTS ${mulliganCount} BACK`
            : "OPENING HAND · KEEP OR DRAW A NEW SEVEN",
          10,
          this.theme.appTheme["muted-foreground"],
          {
            weight: "600",
            width,
            align: "center",
            letterSpacing: 0.7,
          },
        );
        status.anchor.set(0.5, 0);
        status.position.set(width / 2, 0);
        const row = this.layoutActionRow(
          [
            this.makeButton("Keep", action.onMulliganKeep, {
              action: "priority",
              flat: true,
              shadow: true,
              radius: 8,
              disabled,
              width: (width - 6) / 2,
              height: 36,
              icon: "lucide-check",
              iconSize: 14,
              fontSize: 14,
              fontWeight: "900",
              letterSpacing: 1.12,
            }),
            this.makeButton("Mulligan", action.onMulliganDraw, {
              variant: "secondary",
              flat: true,
              shadow: true,
              radius: 8,
              disabled,
              width: (width - 6) / 2,
              height: 36,
              icon: "lucide-rotate-cw",
              iconSize: 14,
              fontSize: 14,
              fontWeight: "900",
              letterSpacing: 1.12,
            }),
          ],
          6,
        );
        row.container.position.set(0, status.height + 6);
        const container = new Container();
        container.addChild(status, row.container);
        return {
          container,
          width,
          height: status.height + 6 + row.height,
        };
      }
      case "mulliganPutBack":
        return this.buildMulliganPutBackView(availableWidth, minimal, touch, disabled);
      case "noAction":
      default:
        return this.buildNoActionView(availableWidth, minimal);
    }
  }

  private makeActionButton(
    label: string,
    icon: string,
    onPress: (() => void) | undefined,
    role: keyof Theme["gameTheme"]["promptAction"] | "priority" | "primary" | "secondary",
    disabled: boolean,
    minimal: boolean,
    touch: boolean,
    options: { badge?: string; title?: string } = {},
  ): PromptButton {
    const showLabel = minimal || touch;
    return this.makeButton(label, onPress, {
      ...(role === "primary" || role === "secondary" ? { variant: role } : { action: role }),
      flat: true,
      shadow: true,
      radius: 8,
      disabled,
      labelPlacement: showLabel ? "stacked" : "hidden",
      tooltip: !showLabel,
      title: options.title ?? label,
      badge: options.badge,
      icon,
      iconSize: 14,
      fontSize: showLabel ? 8 : 12,
      fontWeight: "700",
      letterSpacing: showLabel ? 0.4 : 0,
      paddingX: 6,
    });
  }

  private layoutActionRow(buttons: PromptButton[], gap: number): ActionViewLayout {
    const container = new Container();
    let x = 0;
    let height = 0;
    for (const button of buttons) {
      button.position.set(x, 0);
      container.addChild(button);
      x += button.buttonWidth + gap;
      height = Math.max(height, button.buttonHeight);
    }
    return {
      container,
      width: Math.max(0, x - (buttons.length > 0 ? gap : 0)),
      height,
    };
  }

  private buildChooseActionView(
    availableWidth: number,
    minimal: boolean,
    disabled: boolean,
  ): ActionViewLayout {
    const action = this.spec!.action;
    const stackEmpty = this.spec!.gameView.stack.length === 0;
    const endLabel = stackEmpty ? (action.isMyTurn ? "END TURN" : "NEXT TURN") : "RESOLVE STACK";
    const endTitle = stackEmpty
      ? action.isMyTurn
        ? "Pass until end of turn"
        : "Pass until the next turn"
      : "Pass until the stack is empty";
    const endCombo = resolveCombo("pass-end-of-turn", useKeybindingsStore.getState().overrides);
    const passCombo = resolveCombo("pass-priority", useKeybindingsStore.getState().overrides);
    const morphed = this.endTurnModifiersHeld;
    const counting = this.autopassRemainingMs != null;
    const passLabel = morphed ? endLabel : counting ? "PASSING" : "PASS";
    const combo = morphed ? endCombo : passCombo;
    const height = 40;
    const gap = 4;
    const end = morphed
      ? null
      : this.makeButton(endLabel, action.onPassEndTurn, {
          variant: "secondary",
          flat: true,
          radius: minimal ? 20 : 8,
          disabled,
          height,
          paddingX: minimal ? 12 : 14,
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 1,
          title: endCombo ? `${endTitle} (${comboSymbols(endCombo)})` : endTitle,
        });
    const pass = this.makeButton(
      !minimal && combo ? `${passLabel}  ${comboSymbols(combo)}` : passLabel,
      morphed ? action.onPassEndTurn : action.onPassPriority,
      {
        action: "priority",
        flat: true,
        radius: minimal ? 20 : 8,
        disabled,
        height,
        width: minimal ? undefined : availableWidth - (end ? end.buttonWidth + gap : 0),
        paddingX: 16,
        fontSize: 12,
        fontWeight: "900",
        letterSpacing: 1.44,
        title: morphed ? endTitle : "Pass priority",
      },
    );
    if (counting) {
      this.addAutopassFill(
        pass,
        pass.buttonWidth,
        height,
        minimal ? 20 : 8,
        this.theme.appTheme["primary-foreground"],
      );
    }
    this.priorityButtons = { pass, end };
    return this.layoutActionRow(end ? [pass, end] : [pass], gap);
  }

  private buildNoActionView(availableWidth: number, minimal: boolean): ActionViewLayout {
    const container = new Container();
    const width = minimal ? 30 : availableWidth;
    const height = minimal ? 40 : 48;
    const color = this.theme.appTheme["muted-foreground"];
    const hourglassWidth = 21;
    const labelGap = 11;
    const hourglass = this.makeWaitingHourglass(color);
    if (minimal) {
      hourglass.container.position.set(width / 2, height / 2);
      container.addChild(hourglass.container);
    } else {
      const label = promptText("WAITING FOR OTHERS", 11, color, {
        weight: "600",
        letterSpacing: 1.54,
      });
      label.anchor.set(0, 0.5);
      label.alpha = 0.9;
      const groupWidth = hourglassWidth + labelGap + label.width;
      const groupX = Math.max(0, (width - groupWidth) / 2);
      hourglass.container.position.set(groupX + hourglassWidth / 2, height / 2);
      label.position.set(groupX + hourglassWidth + labelGap, height / 2);
      container.addChild(hourglass.container, label);
    }
    this.startWaitingAnimation(hourglass);
    return { container, width, height };
  }

  private makeWaitingHourglass(color: string): WaitingHourglassVisual {
    const colorValue = hexToNum(color);
    const container = new Container();
    container.eventMode = "none";
    const topSand = new Graphics()
      .moveTo(-5.45, -7)
      .quadraticCurveTo(-5.7, -7, -5.7, -6.75)
      .bezierCurveTo(-5.2, -5.2, -1.65, -1.3, -1.25, 0)
      .lineTo(1.25, 0)
      .bezierCurveTo(1.65, -1.3, 5.2, -5.2, 5.7, -6.75)
      .quadraticCurveTo(5.7, -7, 5.45, -7)
      .closePath()
      .fill({ color: colorValue, alpha: 0.92 });
    topSand.position.y = -1;
    const bottomSand = new Graphics()
      .moveTo(-5.45, 0)
      .quadraticCurveTo(-5.7, 0, -5.7, -0.25)
      .bezierCurveTo(-5.2, -1.8, -1.65, -5.7, -1.25, -7)
      .lineTo(1.25, -7)
      .bezierCurveTo(1.65, -5.7, 5.2, -1.8, 5.7, -0.25)
      .quadraticCurveTo(5.7, 0, 5.45, 0)
      .closePath()
      .fill({ color: colorValue, alpha: 0.92 });
    bottomSand.position.y = 8;
    const stream = new Graphics()
      .roundRect(-0.7, -1, 1.4, 9, 0.7)
      .fill({ color: colorValue, alpha: 0.92 });
    const glass = new Graphics()
      .moveTo(-7.1, -9)
      .bezierCurveTo(-7, -4.7, -2.35, -2.3, -1.5, 0)
      .bezierCurveTo(-2.35, 2.3, -7, 4.7, -7.1, 9)
      .moveTo(7.1, -9)
      .bezierCurveTo(7, -4.7, 2.35, -2.3, 1.5, 0)
      .bezierCurveTo(2.35, 2.3, 7, 4.7, 7.1, 9)
      .stroke({ color: colorValue, width: 1.2, alpha: 0.58, cap: "round" });
    const frame = new Graphics()
      .roundRect(-9.6, -10.7, 19.2, 2.6, 1.3)
      .roundRect(-9.6, 8.1, 19.2, 2.6, 1.3)
      .fill({ color: colorValue, alpha: 0.92 });
    container.addChild(topSand, bottomSand, stream, glass, frame);
    return { container, topSand, bottomSand, stream };
  }

  private startWaitingAnimation(hourglass: WaitingHourglassVisual): void {
    const enabled = animationsEnabled();
    hourglass.container.rotation = 0;
    hourglass.container.scale.set(1);
    hourglass.topSand.scale.y = 1;
    hourglass.bottomSand.scale.y = 0.04;
    hourglass.bottomSand.alpha = 0.22;
    hourglass.stream.scale.y = 0.1;
    hourglass.stream.alpha = 0;
    const timeline = gsap.timeline({ paused: !enabled, repeat: -1, repeatDelay: 0.35 });
    timeline
      .to(hourglass.stream, { alpha: 0.92, duration: 0.12, ease: "power2.out" }, 0.12)
      .to(hourglass.stream.scale, { y: 1, duration: 0.18, ease: "power2.out" }, 0.12)
      .to(hourglass.topSand.scale, { y: 0.08, duration: 1.35, ease: "power1.in" }, 0.18)
      .to(hourglass.bottomSand, { alpha: 0.92, duration: 0.3, ease: "sine.out" }, 0.18)
      .to(hourglass.bottomSand.scale, { y: 1, duration: 1.35, ease: "power1.out" }, 0.18)
      .to(hourglass.stream, { alpha: 0, duration: 0.18, ease: "power2.in" }, 1.38)
      .to(hourglass.container.scale, { x: 1.06, y: 0.9, duration: 0.1, ease: "power2.in" }, 1.73)
      .to(hourglass.container, { rotation: Math.PI, duration: 0.44, ease: "power3.inOut" }, 1.81)
      .to(hourglass.container.scale, { x: 1, y: 1, duration: 0.2, ease: "back.out(1.8)" }, 2.08);
    this.waitingTimeline = timeline;
    this.waitingAnimationActive = enabled;
  }

  private stopWaitingAnimation(): void {
    this.waitingTimeline?.kill();
    this.waitingTimeline = null;
    this.waitingAnimationActive = false;
  }

  private buildPromptLabelView(
    availableWidth: number,
    minimal: boolean,
    touch: boolean,
    disabled: boolean,
  ): ActionViewLayout {
    const action = this.spec!.action;
    const input = this.spec!.currentPrompt?.input;
    const label =
      input?.type === "chooseBoardTargets"
        ? input.presentation.title
        : action.promptType === "chooseBoardTargets"
          ? "Choose a target"
          : action.promptType === "scry"
            ? "Scry"
            : action.promptType === "chooseCards"
              ? "Choose cards"
              : "Waiting...";
    const container = new Container();
    const sourceCard = this.promptSourceCard();
    const source = sourceCard ? this.makeActionCardThumbnail(sourceCard) : null;
    const completion = action.onCompleteTargets
      ? this.makeActionButton(
          action.targetCompletionLabel ?? "Done",
          action.targetCompletionKind === "cancel" ? "lucide-ban" : "lucide-check",
          action.onCompleteTargets,
          action.targetCompletionKind === "cancel" ? "cancel" : "priority",
          disabled,
          minimal,
          touch,
        )
      : null;
    const stripWidth = Math.max(
      110,
      Math.min(
        minimal
          ? 208
          : availableWidth - (source ? 68 : 0) - (completion ? completion.buttonWidth + 6 : 0),
        availableWidth,
      ),
    );
    const strip = new Container();
    const stripBackground = new Graphics()
      .roundRect(0, 0, stripWidth, 36, 8)
      .fill({ color: hexToNum(this.theme.gameTheme.textOnTinted), alpha: 0.05 })
      .stroke({
        color: hexToNum(this.theme.gameTheme.textOnTinted),
        width: 1,
        alpha: 0.2,
      });
    const crosshair = this.makeIcon("lucide-crosshair", 14, this.theme.gameTheme.textOnTinted);
    crosshair.position.set(14, 18);
    crosshair.alpha = 0.8;
    this.actionPulseNodes.push({ node: crosshair, maxAlpha: 0.8 });
    const text = promptRichText(label, 12, this.theme.gameTheme.textOnTinted, stripWidth - 38, {
      weight: "600",
      align: "center",
      letterSpacing: 0.3,
      maxLines: 1,
    });
    text.position.set(32, (36 - text.height) / 2);
    text.alpha = 0.8;
    strip.addChild(stripBackground, crosshair, text);
    if (minimal) {
      let y = 0;
      if (source) {
        source.position.set(
          (Math.max(stripWidth, completion ? stripWidth + completion.buttonWidth + 6 : stripWidth) -
            60) /
            2,
          0,
        );
        container.addChild(source);
        y = 90;
      }
      strip.position.set(0, y);
      container.addChild(strip);
      let width = stripWidth;
      if (completion) {
        completion.position.set(stripWidth + 6, y);
        container.addChild(completion);
        width += 6 + completion.buttonWidth;
      }
      return { container, width, height: y + Math.max(36, completion?.buttonHeight ?? 0) };
    }
    let x = 0;
    if (source) {
      source.position.set(0, 0);
      container.addChild(source);
      x = 68;
    }
    strip.position.set(x, source ? 24 : 0);
    container.addChild(strip);
    x += stripWidth;
    if (completion) {
      completion.position.set(x + 6, source ? 24 : 0);
      container.addChild(completion);
      x += 6 + completion.buttonWidth;
    }
    return {
      container,
      width: x,
      height: source ? 84 : Math.max(36, completion?.buttonHeight ?? 0),
    };
  }

  private buildPayManaView(
    availableWidth: number,
    minimal: boolean,
    touch: boolean,
    disabled: boolean,
  ): ActionViewLayout {
    const action = this.spec!.action;
    const info = action.payManaCostInfo;
    const container = new Container();
    let y = 0;
    let width = 0;
    const sourceCard = this.promptSourceCard();
    if (sourceCard && info) {
      const source = this.makeActionCardThumbnail(sourceCard);
      if (minimal) {
        container.addChild(source);
        y = 92;
        width = 60;
      } else {
        source.position.set(0, 0);
        container.addChild(source);
        const description = info.description || `Cast ${info.cardName} for ${info.manaCost}`;
        const text = promptRichText(
          description,
          12,
          this.theme.appTheme["muted-foreground"],
          availableWidth - 68,
        );
        text.position.set(68, 4);
        container.addChild(text);
        if (info.delveCount) {
          const delved = promptRichText(
            `Delved for {${info.delveCount}}`,
            12,
            this.theme.appTheme["muted-foreground"],
            availableWidth - 68,
          );
          delved.position.set(68, 8 + text.height);
          container.addChild(delved);
        }
        y = 92;
        width = availableWidth;
      }
    } else if (!minimal && info) {
      const description = info.description || `Cast ${info.cardName} for ${info.manaCost}`;
      const text = promptRichText(
        description,
        12,
        this.theme.appTheme["muted-foreground"],
        availableWidth,
        { align: "center" },
      );
      text.position.set(0, 0);
      container.addChild(text);
      y = text.height + 8;
      width = availableWidth;
    }
    if (!minimal && info) {
      const manaInPool = Object.values(info.manaPool).reduce((total, amount) => total + amount, 0);
      const status = promptText(
        info.canConfirmFromPool
          ? `PAYMENT READY · ${manaInPool} MANA IN POOL`
          : manaInPool > 0
            ? `${manaInPool} MANA IN POOL · CHOOSE PAYMENT`
            : "CHOOSE HOW TO PAY",
        10,
        info.canConfirmFromPool
          ? this.theme.appTheme.primary
          : this.theme.appTheme["muted-foreground"],
        {
          weight: "700",
          width: availableWidth,
          align: "center",
          letterSpacing: 0.7,
        },
      );
      status.anchor.set(0.5, 0);
      status.position.set(availableWidth / 2, y);
      container.addChild(status);
      y += status.height + 8;
      width = availableWidth;
    }
    const buttons = [
      this.makeActionButton(
        info?.canConfirmFromPool ? "Confirm" : "Auto",
        info?.canConfirmFromPool ? "lucide-check" : "lucide-wand-sparkles",
        info?.canConfirmFromPool ? action.onPayManaCost : action.onAutoManaCost,
        "priority",
        disabled,
        minimal,
        touch,
      ),
    ];
    if (info?.delveAvailable && info.onOpenDelve) {
      buttons.push(
        this.makeActionButton(
          "Delve",
          "exile",
          info.onOpenDelve,
          "defenseAction",
          disabled,
          minimal,
          touch,
        ),
      );
    }
    if (info?.lifeToPay != null && info.onPayLife) {
      buttons.push(
        this.makeActionButton(
          `${info.lifeToPay} Life`,
          "lucide-heart-crack",
          info.onPayLife,
          "attackAction",
          disabled,
          minimal,
          touch,
        ),
      );
    }
    buttons.push(
      this.makeActionButton(
        "Cancel",
        "lucide-ban",
        action.onCancelManaCost,
        "cancel",
        disabled,
        minimal,
        touch,
      ),
    );
    const rows = this.layoutWrappedActionButtons(
      buttons,
      minimal ? this.viewportWidth - 24 : availableWidth,
      12,
    );
    if (minimal && info?.sourceCard) {
      const source = container.children[0];
      if (source) source.x = Math.max(0, (rows.width - 60) / 2);
    }
    rows.container.position.set(minimal ? 0 : Math.max(0, (availableWidth - rows.width) / 2), y);
    container.addChild(rows.container);
    return {
      container,
      width: Math.max(width, minimal ? rows.width : availableWidth),
      height: y + rows.height,
    };
  }

  private buildMulliganPutBackView(
    availableWidth: number,
    minimal: boolean,
    touch: boolean,
    disabled: boolean,
  ): ActionViewLayout {
    const action = this.spec!.action;
    const selected = action.mulliganSelectedCount ?? 0;
    const count = action.mulliganPutBackCount ?? 0;
    const canConfirm = !disabled && selected === count;
    if (minimal) {
      const label = promptText(
        `${selected}/${count} selected`,
        10,
        this.theme.appTheme["muted-foreground"],
        {
          weight: "600",
          letterSpacing: 0.8,
        },
      );
      label.anchor.set(0, 0.5);
      const button = this.makeActionButton(
        "Confirm",
        "lucide-check",
        action.onMulliganPutBackConfirm,
        "primary",
        !canConfirm,
        true,
        touch,
      );
      label.position.set(0, button.buttonHeight / 2);
      button.position.set(label.width + 6, 0);
      const container = new Container();
      container.addChild(label, button);
      return {
        container,
        width: label.width + 6 + button.buttonWidth,
        height: button.buttonHeight,
      };
    }
    const width = Math.max(120, availableWidth * 0.6);
    const container = new Container();
    const label = promptText(
      `SELECTED ${selected} OF ${count} · LIBRARY BOTTOM`,
      10,
      canConfirm ? this.theme.appTheme.foreground : this.theme.appTheme["muted-foreground"],
      {
        weight: "600",
        letterSpacing: 0.8,
      },
    );
    label.anchor.set(0.5, 0);
    label.position.set(width / 2, 0);
    const button = this.makeButton("CONFIRM", action.onMulliganPutBackConfirm, {
      flat: true,
      shadow: true,
      radius: 8,
      disabled: !canConfirm,
      width,
      height: 36,
      icon: "lucide-check",
      iconSize: 14,
      fontSize: 14,
      fontWeight: "900",
      letterSpacing: 1.12,
    });
    button.position.set(0, label.height + 6);
    container.addChild(label, button);
    return { container, width, height: label.height + 6 + button.buttonHeight };
  }

  private makeActionPanelSurface(
    width: number,
    height: number,
    radius: number,
    squareBottom: boolean,
  ): Graphics {
    const surface = new Graphics();
    surface
      .roundRect(0, 4, width, height, radius)
      .fill({ color: hexToNum(this.theme.gameTheme.canvas.shadow), alpha: 0.18 })
      .roundRect(0, 0, width, height, radius)
      .fill({ color: hexToNum(this.theme.appTheme.card), alpha: 0.95 });
    if (squareBottom) {
      surface
        .rect(0, height - radius, width, radius)
        .fill({ color: hexToNum(this.theme.appTheme.card), alpha: 0.95 })
        .moveTo(0, height)
        .lineTo(0, radius)
        .quadraticCurveTo(0, 0, radius, 0)
        .lineTo(width - radius, 0)
        .quadraticCurveTo(width, 0, width, radius)
        .lineTo(width, height)
        .stroke({ color: hexToNum(this.theme.appTheme.border), width: 1, alpha: 0.7 });
    } else {
      surface
        .roundRect(0, 0, width, height, radius)
        .stroke({ color: hexToNum(this.theme.appTheme.border), width: 1, alpha: 0.7 });
    }
    surface.eventMode = "none";
    return surface;
  }

  private makeActionMenuButton(minimal: boolean): ActionViewLayout {
    const size = minimal ? 22 : 18;
    const button = new Container();
    const icon = this.makeIcon("lucide-settings", 14, this.theme.gameTheme.textOnTinted);
    icon.position.set(size / 2, size / 2);
    button.addChild(icon);
    button.eventMode = "static";
    button.cursor = "pointer";
    const inset = minimal ? 8 : 10;
    button.hitArea = new Rectangle(-inset, -inset, size + inset * 2, size + inset * 2);
    button.on("pointerover", () => {
      icon.alpha = 0.75;
    });
    button.on("pointerout", () => {
      icon.alpha = 1;
    });
    button.on("focusin", () => {
      icon.alpha = 0.75;
    });
    button.on("focusout", () => {
      icon.alpha = 1;
    });
    button.accessible = true;
    button.accessibleTitle = "Open game menu";
    button.tabIndex = 0;
    if (minimal) {
      button.on("pointerdown", (event: FederatedPointerEvent) => event.stopPropagation());
    }
    button.on("pointertap", () => this.spec!.action.onToggleBoardMenu());
    return { container: button, width: size, height: size };
  }

  private makePriorityModePill(disabled: boolean): PromptButton {
    const state = usePromptPreferencesStore.getState();
    const combo = resolveCombo("toggle-priority-mode", useKeybindingsStore.getState().overrides);
    const fullControl = state.fullControl;
    const hint = combo ? ` (${formatCombo(combo)})` : "";
    return this.makeButton(
      fullControl ? "FULL CTRL" : "AUTOPASS",
      () => {
        const next = !usePromptPreferencesStore.getState().fullControl;
        usePromptPreferencesStore.getState().setFullControl(next);
      },
      {
        title: fullControl
          ? `Full control — you stop at every priority window${hint}`
          : `Autopass: dead priority windows pass automatically${hint}`,
        icon: fullControl ? "lucide-hand" : "lucide-zap",
        iconSize: 12,
        outline: true,
        backgroundColor: this.theme.gameTheme.textOnTinted,
        backgroundAlpha: fullControl ? 0.15 : 0.05,
        borderColor: fullControl ? this.theme.gameTheme.textOnTinted : this.theme.appTheme.border,
        hoverBackgroundAlpha: fullControl ? 0.2 : 0.1,
        hoverBorderAlpha: fullControl ? 0.3 : 1,
        pressOffsetY: 1,
        borderAlpha: fullControl ? 0.3 : 0.6,
        disabled,
        width: fullControl ? 88 : 86,
        height: 22,
        paddingX: 8,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 1.08,
      },
    );
  }

  private layoutWrappedActionButtons(
    buttons: PromptButton[],
    maxWidth: number,
    gap: number,
  ): ActionViewLayout {
    const container = new Container();
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    let width = 0;
    for (const button of buttons) {
      if (x > 0 && x + button.buttonWidth > maxWidth) {
        x = 0;
        y += rowHeight + gap;
        rowHeight = 0;
      }
      button.position.set(x, y);
      container.addChild(button);
      x += button.buttonWidth + gap;
      width = Math.max(width, Math.min(maxWidth, x - gap));
      rowHeight = Math.max(rowHeight, button.buttonHeight);
    }
    return { container, width, height: y + rowHeight };
  }

  private makeActionCardThumbnail(card: CardDto): Container {
    const container = new Container();
    const sprite = new CardSprite(card, "zone");
    const place = () => {
      sprite.scale.set(1);
      const scale = 60 / sprite.width;
      sprite.scale.set(scale);
      sprite.position.set(sprite.pivot.x * scale, sprite.pivot.y * scale);
    };
    sprite.onReorient = place;
    place();
    sprite.eventMode = "none";
    container.addChild(sprite);
    container.hitArea = new Rectangle(0, 0, 60, 84);
    return container;
  }

  private addAutopassFill(
    button: PromptButton,
    width: number,
    height: number,
    radius: number,
    color: string,
  ): void {
    const progress = 1 - this.autopassRemainingMs! / this.autopassTotalMs;
    const fill = new Graphics()
      .roundRect(0, 0, width, height, radius)
      .fill({ color: hexToNum(color), alpha: 0.25 });
    fill.scale.x = progress;
    fill.eventMode = "none";
    button.addProgressFill(fill);
    this.autopassFill = fill;
  }

  private updateEndTurnModifiers(event: KeyboardEvent | PointerEvent): void {
    const combo = resolveCombo("pass-end-of-turn", useKeybindingsStore.getState().overrides);
    if (!combo) {
      this.setEndTurnModifiersHeld(false);
      return;
    }
    const normalized = normalizeCombo(combo);
    const hasModifier =
      !!normalized.meta || !!normalized.ctrl || !!normalized.alt || !!normalized.shift;
    const held =
      hasModifier &&
      (!normalized.meta || event.metaKey) &&
      (!normalized.ctrl || event.ctrlKey) &&
      (!normalized.alt || event.altKey) &&
      (!normalized.shift || event.shiftKey);
    this.setEndTurnModifiersHeld(held);
  }

  private setEndTurnModifiersHeld(held: boolean): void {
    if (held === this.endTurnModifiersHeld) return;
    this.endTurnModifiersHeld = held;
    if (this.spec?.action.promptType === "chooseAction") this.rebuild();
  }

  private resetAutopassState(): void {
    this.autopassRemainingMs = null;
    this.autopassTotalMs = 0;
    if (!isAutopassWindow(this.spec)) return;
    this.autopassTotalMs =
      AUTOPASS_DELAY_MIN_MS + Math.random() * (AUTOPASS_DELAY_MAX_MS - AUTOPASS_DELAY_MIN_MS);
    this.autopassRemainingMs = this.autopassTotalMs;
  }

  private flashActionGlow(): void {
    if (!this.actionGlow || !animationsEnabled()) return;
    this.actionGlowTween?.kill();
    this.actionGlowTween = gsap
      .timeline()
      .to(this.actionFeedback, { glow: 1, duration: 0.1, ease: "power2.out" })
      .to(this.actionFeedback, { glow: 0, duration: 0.6, ease: "sine.out" });
  }

  private bumpActionPanel(endTurn = false): void {
    if (
      !this.spec ||
      this.spec.action.isWaitingForResponse ||
      this.spec.action.isWaitingForOthers ||
      !animationsEnabled()
    )
      return;
    this.actionFeedbackEndTurn = endTurn;
    gsap.fromTo(
      this.actionFeedback,
      { press: 1 },
      {
        press: 0,
        duration: 0.28,
        ease: "power2.out",
        overwrite: "auto",
      },
    );
    this.syncActionFeedback(performance.now());
  }

  private syncActionFeedback(elapsed: number): void {
    if (!animationsEnabled()) {
      this.actionGlowTween?.kill();
      gsap.killTweensOf(this.actionFeedback);
      this.actionFeedback.glow = 0;
      this.actionFeedback.press = 0;
    }
    this.actionGlow?.update(elapsed, this.actionFeedback.glow);
    const buttons = this.priorityButtons;
    if (!buttons) return;
    buttons.pass.setPressFeedback(
      this.actionFeedbackEndTurn && buttons.end ? 0 : this.actionFeedback.press,
    );
    buttons.end?.setPressFeedback(this.actionFeedbackEndTurn ? this.actionFeedback.press : 0);
  }

  private buildActionCombatInfo(availableWidth: number): ActionViewLayout | null {
    const action = this.spec!.action;
    const container = new Container();
    const destructive = this.theme.appTheme.destructive;
    const muted = this.theme.appTheme["muted-foreground"];
    let y = 0;
    let visible = false;

    if (action.combatPairings.length > 0) {
      visible = true;
      const pairingsHeight = 16 + action.combatPairings.length * 16;
      container.addChild(
        new Graphics()
          .roundRect(0, y, availableWidth, pairingsHeight, 8)
          .fill({ color: hexToNum(destructive), alpha: 0.1 }),
      );
      for (const [index, pairing] of action.combatPairings.entries()) {
        const rowY = y + 12 + index * 16;
        const attacker = promptText(pairing.attacker, 12, this.theme.appTheme.foreground, {
          weight: "600",
        });
        attacker.position.set(8, rowY - attacker.height / 2);
        const verb = promptText(pairing.attacker === "You" ? "attack" : "attacks", 12, muted);
        verb.position.set(
          Math.min(availableWidth - 100, 14 + attacker.width),
          rowY - verb.height / 2,
        );
        const defender = promptText(pairing.defender, 12, destructive, { weight: "600" });
        defender.position.set(
          Math.min(availableWidth - defender.width - 28, verb.x + verb.width + 6),
          rowY - defender.height / 2,
        );
        container.addChild(attacker, verb, defender);
        if (pairing.count > 1) {
          const count = promptText(`×${pairing.count}`, 10, destructive, { weight: "700" });
          count.anchor.set(1, 0.5);
          count.position.set(availableWidth - 8, rowY);
          const badgeWidth = count.width + 8;
          container.addChild(
            new Graphics()
              .roundRect(availableWidth - badgeWidth - 6, rowY - 8, badgeWidth, 16, 3)
              .fill({ color: hexToNum(destructive), alpha: 0.15 }),
            count,
          );
        }
      }
      y += pairingsHeight + 8;
    }

    const isAttackDecl = action.promptType === "chooseAttackers";
    const isBlockDecl = action.promptType === "chooseBlockers";
    const activeAttackers = isAttackDecl ? action.pendingAttackers : action.attackerIds;
    const sample =
      useGameDevStore.getState().gameStateOverrides.forceCombatSummary &&
      activeAttackers.length === 0;
    if ((isAttackDecl || isBlockDecl || sample) && (activeAttackers.length > 0 || sample)) {
      visible = true;
      const summary = summarizeCombat(activeAttackers, action.blockAssignments, action.resolveCard);
      const attackerCount = sample ? 3 : summary.attackerCount;
      const blockedCount = sample ? 1 : summary.blockedCount;
      const unblockedCount = attackerCount - blockedCount;
      const incomingDamage = sample ? 7 : summary.estimatedDamage;
      const firstStrike = sample || summary.firstStrike;
      const lethal =
        sample ||
        (isBlockDecl &&
          action.combatDefenderLife != null &&
          incomingDamage >= action.combatDefenderLife);
      const showIncoming = isBlockDecl || sample;
      const height = firstStrike ? 50 : 34;
      container.addChild(
        new Graphics()
          .roundRect(0, y, availableWidth, height, 8)
          .fill({ color: hexToNum(destructive), alpha: 0.1 })
          .stroke({ color: hexToNum(destructive), width: 1, alpha: 0.25 }),
      );
      const swords = this.makeIcon("lucide-swords", 14, destructive);
      swords.position.set(14, y + 17);
      const count = promptText(
        `${attackerCount} ${attackerCount === 1 ? "attacker" : "attackers"}`,
        12,
        this.theme.appTheme.foreground,
        { weight: "600" },
      );
      count.position.set(24, y + 17 - count.height / 2);
      container.addChild(swords, count);
      let x = count.x + count.width + 8;
      if (showIncoming) {
        const blocks = promptText(`${blockedCount} blocked · ${unblockedCount} open`, 12, muted);
        blocks.position.set(x, y + 17 - blocks.height / 2);
        container.addChild(blocks);
        x += blocks.width + 8;
      }
      const damage = promptText(
        `${showIncoming ? "Est." : "Open"} ${incomingDamage}`,
        12,
        lethal ? destructive : this.theme.appTheme.foreground,
        { weight: lethal ? "700" : "600" },
      );
      damage.position.set(
        Math.min(x, availableWidth - damage.width - (isBlockDecl ? 30 : 8)),
        y + 17 - damage.height / 2,
      );
      container.addChild(damage);
      if (firstStrike) {
        const strike = promptText("First or double strike", 12, this.theme.appTheme.warning, {
          weight: "500",
        });
        const zap = this.makeIcon("lucide-zap", 12, this.theme.appTheme.warning);
        zap.position.set(14, y + 40);
        strike.position.set(24, y + 40 - strike.height / 2);
        container.addChild(zap, strike);
      }
      if (lethal) {
        const lethalLabel = promptText("LETHAL?", 10, destructive, {
          weight: "700",
          letterSpacing: 0.5,
        });
        lethalLabel.anchor.set(1, 0.5);
        lethalLabel.position.set(
          availableWidth - (isBlockDecl ? 30 : 8),
          y + (firstStrike ? 40 : 17),
        );
        container.addChild(lethalLabel);
      }
      if ((isAttackDecl || isBlockDecl) && !sample && action.onOpenCombat) {
        const info = this.makeIcon("lucide-info", 14, muted);
        info.position.set(availableWidth - 14, y + 17);
        const target = new Container();
        target.position.set(availableWidth - 28, y + 3);
        target.hitArea = new Rectangle(0, 0, 28, 28);
        target.eventMode = "static";
        target.cursor = "pointer";
        target.accessible = true;
        target.accessibleTitle = "Combat breakdown";
        target.tabIndex = 0;
        target.on("pointertap", action.onOpenCombat);
        container.addChild(info, target);
      }
      y += height;
    }

    return visible ? { container, width: availableWidth, height: y } : null;
  }

  private renderActionContextPopover(
    panelX: number,
    panelY: number,
    panelWidth: number,
    titleValue: string,
  ): void {
    const action = this.spec!.action;
    const lines = getPromptContextLines(
      promptTypeForView(action.promptType, action.promptActionOverride),
      {
        mulliganCount: action.mulliganCount,
        mustAttackHint: action.mustAttackHint,
        blockRestrictionHint: action.blockRestrictionHint,
        payManaCostInfo: action.payManaCostInfo,
        mulliganPutBackCount: action.mulliganPutBackCount,
        mulliganSelectedCount: action.mulliganSelectedCount,
      },
    );
    const width = Math.min(256, Math.max(120, panelX + panelWidth - 8));
    const popover = new Container();
    const title = promptText(titleValue.toUpperCase(), 11, this.theme.appTheme.foreground, {
      weight: "700",
      letterSpacing: 1.32,
      width: width - 24,
    });
    title.position.set(12, 8);
    title.alpha = 0.9;
    popover.addChild(title);
    let y = 8 + title.height + 6;
    for (const line of lines) {
      const text = promptRichText(line, 11, this.theme.appTheme["muted-foreground"], width - 24);
      text.position.set(12, y);
      popover.addChild(text);
      y += text.height + 4;
    }
    const combat = this.buildActionCombatInfo(width - 24);
    if (combat) {
      combat.container.position.set(12, y + 2);
      popover.addChild(combat.container);
      y += combat.height + 6;
    }
    const contentHeight = y + 4;
    const height = Math.min(contentHeight, this.viewportHeight * 0.55, Math.max(48, panelY - 16));
    popover.addChildAt(this.makeActionPanelSurface(width, height, 8, false), 0);
    if (height < contentHeight) {
      const mask = new Graphics()
        .rect(0, 0, width, height)
        .fill({ color: hexToNum(this.theme.appTheme.foreground) });
      popover.addChild(mask);
      popover.mask = mask;
    }
    popover.position.set(
      Math.max(8, panelX + panelWidth - width),
      Math.max(8, panelY - height - 8),
    );
    popover.eventMode = "none";
    popover.zIndex = 20;
    this.container.addChild(popover);
  }
  private cancelPointerDrag(event: FederatedPointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.cancelDrag();
    this.rebuild();
  }

  private handleKey(event: KeyboardEvent): void {
    const modal = topModal();
    if ((modal && !modal.contains(this.app.canvas)) || event.defaultPrevented || event.isComposing)
      return;
    if (!this.spec || !this.modalOpen) return;
    const primaryActionKey = event.key === "Enter" || event.code === "Space";
    if (
      !this.selectionFilterFocused &&
      event.code !== "Space" &&
      this.handlePromptCardShortcut(event)
    )
      return;
    if (this.spec.gameOver && primaryActionKey && !event.repeat) {
      event.preventDefault();
      this.spec.gameOver.onEndGame();
      return;
    }
    const input = this.spec.currentPrompt?.input;
    if (
      input?.type === "chooseFromSelection" &&
      input.options.length > 5 &&
      (event.key === "Backspace" ||
        (event.key.length === 1 &&
          (this.selectionFilterFocused || event.code !== "Space") &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey))
    ) {
      event.preventDefault();
      this.selectionFilterFocused = true;
      this.selectionFilter =
        event.key === "Backspace"
          ? this.selectionFilter.slice(0, -1)
          : `${this.selectionFilter}${event.key}`;
      this.rebuild();
      return;
    }
    if (event.key === "Escape" && this.selectionFilter) {
      event.preventDefault();
      this.selectionFilter = "";
      this.rebuild();
      return;
    }
    if (event.key === "Escape" && !this.spec.gameOver) {
      event.preventDefault();
      this.spec.onHideModal();
      return;
    }
    if (!input) return;
    if (input.type === "chooseNumber" && input.max - input.min + 1 > 10) {
      const parsed = Number(this.numberBuffer);
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        this.numberValue = Math.max(input.min, (Number.isInteger(parsed) ? parsed : input.min) - 1);
        this.numberBuffer = String(this.numberValue);
        this.rebuild();
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        this.numberValue = Math.min(input.max, (Number.isInteger(parsed) ? parsed : input.min) + 1);
        this.numberBuffer = String(this.numberValue);
        this.rebuild();
      } else if (/^\d$/.test(event.key) || (event.key === "-" && input.min < 0)) {
        event.preventDefault();
        this.numberBuffer =
          event.key === "-"
            ? this.numberBuffer.startsWith("-")
              ? this.numberBuffer
              : `-${this.numberBuffer}`
            : this.numberBuffer === "0"
              ? event.key
              : `${this.numberBuffer}${event.key}`;
        this.rebuild();
      } else if (event.key === "Backspace") {
        event.preventDefault();
        this.numberBuffer = this.numberBuffer.slice(0, -1);
        this.rebuild();
      } else if (
        primaryActionKey &&
        !event.repeat &&
        this.numberBuffer !== "" &&
        this.numberBuffer !== "-" &&
        Number.isInteger(parsed) &&
        parsed >= input.min &&
        parsed <= input.max
      ) {
        event.preventDefault();
        this.spec.respond({ type: "numberDecision", chosenNumber: parsed });
      }
      return;
    }
    if (!primaryActionKey || event.repeat) return;
    if (input.type === "chooseBoolean") {
      event.preventDefault();
      this.spec.respond({ type: "decision", value: true });
    } else if (input.type === "revealCards") {
      event.preventDefault();
      this.spec.respond({ type: "revealCardsAcknowledged" });
    } else if (input.type === "chooseCards") {
      const chosen = [...this.selectedIds];
      if (chosen.length >= input.min && chosen.length <= input.max) {
        event.preventDefault();
        this.spec.respond({ type: "chooseCardsDecision", chosenCardIds: chosen });
      }
    } else if (input.type === "chooseColor") {
      const total = [...this.counts.values()].reduce((sum, value) => sum + value, 0);
      if (total === input.amount) {
        const chosenColors: Record<string, number> = {};
        for (const [color, count] of this.counts) {
          if (typeof color === "string" && count > 0) chosenColors[color] = count;
        }
        event.preventDefault();
        this.spec.respond({ type: "colorDecision", chosenColors });
      }
    } else if (input.type === "chooseFromSelection") {
      const total = this.selectionTotal(input.options);
      if (total >= input.minTotal && total <= input.maxTotal) {
        event.preventDefault();
        const chosenIndices = [...this.counts.entries()]
          .sort(([left], [right]) => Number(left) - Number(right))
          .flatMap(([index, count]) => Array.from({ length: count }, () => Number(index)));
        this.spec.respond({ type: "selectionDecision", chosenIndices });
      }
    } else if (input.type === "reorder") {
      event.preventDefault();
      this.spec.respond({ type: "reorderDecision", orderedIds: [...this.order] });
    } else if (input.type === "scry") {
      if ((this.scryItems.pool ?? []).length === 0) {
        event.preventDefault();
        this.spec.respond({
          type: "scryDecision",
          zoneCardIds: input.zones.map((_, index) =>
            [...(this.scryItems[`zone-${index}`] ?? [])].reverse(),
          ),
        });
      }
    } else if (input.type === "chooseDamageAssignmentOrder") {
      if (
        this.spec.damageOrder &&
        this.spec.damageOrder.order.length >= this.spec.damageOrder.blockerCards.length
      ) {
        event.preventDefault();
        this.spec.damageOrder.onConfirm();
      }
    } else if (input.type === "diceRolled" && this.rollElapsedMs >= this.rollDurationMs) {
      event.preventDefault();
      this.spec.respond({ type: "diceRolledAcknowledged" });
    } else if (input.type === "chooseCombatDamageAssignment") {
      const assignees = [...input.blockerIds, ...(input.defenderId ? [input.defenderId] : [])];
      const remaining =
        input.totalDamage -
        Object.values(this.damageAssigned).reduce((sum, value) => sum + value, 0);
      if (remaining === 0 && this.damageLegallyOrdered(input, assignees)) {
        event.preventDefault();
        this.spec.respond({
          type: "combatDamageAssignmentDecision",
          assignments: assignees.map((assigneeId) => ({
            assigneeId,
            damage: this.damageAssigned[assigneeId] ?? 0,
          })),
        });
      }
    }
  }

  update(deltaMs: number): void {
    const elapsed = performance.now();
    const motionEnabled = animationsEnabled();
    this.updateDragMotion(deltaMs);
    this.syncActionFeedback(elapsed);
    if (this.selectionFilterView) {
      this.selectionFilterView.caret.visible =
        this.selectionFilterFocused &&
        (!motionEnabled ||
          (elapsed - this.selectionFilterBlinkAt) % FILTER_CARET_PERIOD_MS <
            FILTER_CARET_PERIOD_MS / 2);
    }
    if (!motionEnabled && this.entranceTween) this.entranceTween.progress(1);
    if (this.waitingTimeline && motionEnabled !== this.waitingAnimationActive) {
      this.waitingAnimationActive = motionEnabled;
      if (motionEnabled) this.waitingTimeline.restart();
      else this.waitingTimeline.pause(0);
    }
    if (motionEnabled) {
      const actionPulse = (1 - Math.cos((elapsed / 3600) * Math.PI * 2)) / 2;
      for (const { node, maxAlpha } of this.actionPulseNodes) {
        node.alpha = maxAlpha * (0.8 + actionPulse * 0.2);
      }
    } else {
      for (const { node, maxAlpha } of this.actionPulseNodes) node.alpha = maxAlpha;
    }

    if (this.autopassRemainingMs != null) {
      const canAutopass = isAutopassWindow(this.spec);
      if (!canAutopass) {
        this.autopassRemainingMs = null;
        this.autopassTotalMs = 0;
        this.rebuild();
      } else {
        this.autopassRemainingMs -= deltaMs;
        if (this.autopassRemainingMs <= 0) {
          this.autopassRemainingMs = null;
          this.spec!.action.onPassPriority();
        } else if (this.autopassFill && this.autopassTotalMs > 0) {
          this.autopassFill.scale.x = 1 - this.autopassRemainingMs / this.autopassTotalMs;
        }
      }
    }
    const input = this.spec?.currentPrompt?.input;
    const isRollResult = input?.type === "diceRolled";
    if (!this.modalOpen || !isRollResult || this.rollSettled) return;
    this.syncRollVisuals();
  }
}
