import {
  Application,
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  RenderLayer,
  Sprite,
  Text,
  TextStyle,
} from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { CardSprite } from "@/pixi/CardSprite";
import { gameIconTexture } from "@/pixi/gameIconCache";
import { loadManaSymbolTexture } from "@/pixi/manaSymbolCache";
import { PixiRichText } from "@/pixi/cardPreview/PixiRichText";
import { deckCardToPreviewDto } from "@/lib/scryfall.utils";
import {
  CARD_H,
  CARD_HOVER_TRANSITION_SECONDS,
  CARD_RADIUS,
  CARD_W,
  GAME_CARD_SIZES,
  PASSIVE_CARD_HOVER_SCALE,
} from "@/components/game/game.constants";
import {
  fitPromptCardDimensions,
  promptCardDisplayDimensions as getPromptCardDisplayDimensions,
} from "@/components/game/game.utils";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { type PromptActionViewKey } from "@/stores/useGameDevStore";
import { resolveCombo, useKeybindingsStore } from "@/stores/useKeybindingsStore";
import { comboFromEvent, combosMatch, formatCombo } from "@/lib/keybindings";
import type { CardDto } from "@/protocol";
import { PromptButton, type PromptButtonOptions } from "./PromptButton";
import { PromptGlow } from "./PromptGlow";
import { LongPressGesture } from "@/pixi/LongPressGesture";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
import {
  DRAG_LIFT_SCALE,
  dragPositionBlend,
  dragTiltForMovement,
  dragTransformBlend,
} from "@/pixi/dragMotion";
import type { PromptLayerCallbacks, PromptOverlaySpec } from "./prompt.types";
import { type RollTokenVisual } from "./dice/DiceGeometry";
import { type RollTrajectory } from "./dice/DiceAnimation";

export const MODAL_TYPES = new Set([
  "chooseBoolean",
  "chooseFromSelection",
  "revealCards",
  "scry",
  "chooseColor",
  "chooseNumber",
  "chooseCombatDamageAssignment",
  "chooseDamageAssignmentOrder",
  "chooseCards",
  "reorder",
  "diceRolled",
]);
const FONT = "Inter, system-ui, sans-serif";
export const PANEL_PADDING = 20;
export const ROW_GAP = 10;
const CARD_HOVER_Z_INDEX = 600;
export const CARD_TILE_EDGE_INSET = 8;
export const REORDER_MODAL_VERTICAL_RESERVE = 280;
export const REORDER_ORDER_ZONE_ID = "reorder-order";
export const REORDER_CARD_INSET = 18;
export const REORDER_LAYOUT_SETTLE_SECONDS = 0.24;
export const CARD_ASPECT_RATIO = CARD_H / CARD_W;
export const SCRY_BODY_FIXED_HEIGHT = 102;
export const MODAL_MIN_HEIGHT = 160;
export const MODAL_BODY_BOTTOM_PADDING = 8;
export const SOURCE_CARD_GAP = 20;
export const SOURCE_LABEL_HEIGHT = 18;
const DRAG_START_THRESHOLD = 4;
const DRAG_LAYER_Z_INDEX = 1000;
const DRAG_DROP_MIN_SECONDS = 0.1;
const DRAG_DROP_MAX_SECONDS = 0.22;
const DRAG_DROP_PIXELS_PER_SECOND = 1800;
const DROP_ZONE_DIM_ALPHA = 0.62;
const DROP_ZONE_TWEEN_SECONDS = 0.12;
export const REORDER_PREVIEW_SECONDS = 0.14;
export const FILTER_CARET_PERIOD_MS = 1000;
export const SCRY_LAYOUT_SETTLE_SECONDS = 0.2;
export const MODAL_SCROLL_LINE_HEIGHT = 16;
export const MODAL_SCROLL_SCALE = 0.35;
export const MODAL_SCROLL_MAX_STEP = 56;

interface DragState {
  item: Container;
  pointerId: number;
  startGlobalX: number;
  startGlobalY: number;
  originX: number;
  originY: number;
  offsetX: number;
  offsetY: number;
  targetX: number;
  targetY: number;
  settling: boolean;
  hasMoved: boolean;
  restRotation: number;
  restScaleX: number;
  restScaleY: number;
  restOriginX: number;
  restOriginY: number;
  lastGlobalX: number;
  targetRotation: number;
  settleProgress: number;
  settleTween: gsap.core.Tween | null;
  ring: Graphics;
  renderLayer: RenderLayer | null;
  onDrop: (x: number, y: number) => void;
  resolveDropPosition?: (x: number, y: number) => { x: number; y: number } | null;
  onDragMove?: (x: number, y: number) => void;
}

interface RollVisual {
  token: RollTokenVisual;
  finalValue: number | string;
  sides: number;
  seed: number;
  trajectory: RollTrajectory;
  baseX: number;
  baseY: number;
  startX: number;
  startY: number;
  restingRotation: number;
  ignored: boolean;
  ignoredMark: Graphics | null;
}
export interface RollDisplayEntry {
  sides: number;
  value: number | string;
  label?: string;
  playerId?: string;
  detail?: string;
  round: number;
  highlighted: boolean;
  ignored: boolean;
}

interface DropZone {
  id: string;
  rect: Rectangle;
  container: Container;
  visual: Graphics;
  dropX: number;
  dropY: number;
  targetAlpha: number;
  marker?: Graphics;
}
interface PromptCardDisplayState {
  rulesView: boolean;
  face: 0 | 1;
  horizontalFlipped: boolean;
}

export function promptText(
  value: string,
  size: number,
  color: string,
  options: {
    weight?: "400" | "500" | "600" | "700" | "800" | "900";
    width?: number;
    align?: "left" | "center";
    style?: "normal" | "italic";
    letterSpacing?: number;
    lineHeight?: number;
    truncate?: boolean;
  } = {},
): Text {
  const text = new Text({
    text: value,
    style: new TextStyle({
      fontFamily: FONT,
      fontSize: size,
      fontWeight: options.weight ?? "400",
      fontStyle: options.style ?? "normal",
      letterSpacing: options.letterSpacing ?? 0,
      fill: hexToNum(color),
      align: options.align ?? "left",
      wordWrap: options.width != null && !options.truncate,
      wordWrapWidth: options.width,
      lineHeight: options.lineHeight ?? Math.ceil(size * 1.35),
    }),
  });
  if (options.truncate && options.width != null && text.width > options.width) {
    let low = 0;
    let high = value.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      text.text = `${value.slice(0, middle).trimEnd()}…`;
      if (text.width <= options.width) low = middle;
      else high = middle - 1;
    }
    text.text = `${value.slice(0, low).trimEnd()}…`;
  }
  text.eventMode = "none";
  return text;
}
export function promptRichText(
  value: string,
  size: number,
  color: string,
  width: number,
  options: {
    weight?: "400" | "500" | "600" | "700" | "800" | "900";
    align?: "left" | "center";
    style?: "normal" | "italic";
    letterSpacing?: number;
    lineHeight?: number;
    maxLines?: number;
  } = {},
): PixiRichText {
  const text = new PixiRichText();
  text.setContent(
    value,
    new TextStyle({
      fontFamily: FONT,
      fontSize: size,
      fontWeight: options.weight ?? "400",
      fontStyle: options.style ?? "normal",
      letterSpacing: options.letterSpacing ?? 0,
      fill: hexToNum(color),
      lineHeight: options.lineHeight ?? Math.ceil(size * 1.35),
    }),
    width,
    Math.ceil(size * 1.15),
    2,
    { align: options.align, maxLines: options.maxLines },
  );
  text.eventMode = "none";
  return text;
}

export function parseCombatNumber(value?: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface ActionViewLayout {
  container: Container;
  width: number;
  height: number;
}
export interface WaitingHourglassVisual {
  container: Container;
  topSand: Graphics;
  bottomSand: Graphics;
  stream: Graphics;
}

function runtimeActionView(
  promptType: PromptOverlaySpec["action"]["promptType"],
): PromptActionViewKey {
  switch (promptType) {
    case undefined:
    case "gameOver":
      return "noAction";
    case "chooseAction":
    case "chooseAttackers":
    case "chooseBlockers":
    case "payManaCost":
    case "mulligan":
    case "mulliganPutBack":
      return promptType;
    case "chooseBoardTargets":
      return "promptLabel";
    default:
      return "promptRequired";
  }
}
export function actionViewKey(action: PromptOverlaySpec["action"]): PromptActionViewKey {
  if (action.promptActionOverride != null) return action.promptActionOverride;
  return action.isWaitingForOthers ? "noAction" : runtimeActionView(action.promptType);
}

export function promptTypeForView(
  promptType: PromptOverlaySpec["action"]["promptType"],
  override: PromptActionViewKey | null | undefined,
): PromptOverlaySpec["action"]["promptType"] {
  if (!override) return promptType;
  if (override === "chooseTargetSpell" || override === "promptLabel") return "chooseBoardTargets";
  if (override === "chooseDamageOrder") return "chooseDamageAssignmentOrder";
  if (override === "promptRequired" || override === "noAction") return undefined;
  return override;
}

export function actionTitle(promptType: PromptOverlaySpec["action"]["promptType"]): string {
  switch (promptType) {
    case "chooseAction":
      return "Priority";
    case "chooseAttackers":
      return "Declare Attackers";
    case "chooseBlockers":
      return "Declare Blockers";
    case "chooseBoardTargets":
      return "Choose Targets";
    case "chooseDamageAssignmentOrder":
      return "Damage Order";
    case "payManaCost":
      return "Pay Mana";
    case "mulligan":
    case "mulliganPutBack":
      return "Mulligan";
    default:
      return "Action Required";
  }
}
export function isAutopassWindow(spec: PromptOverlaySpec | null): boolean {
  const input = spec?.currentPrompt?.input;
  return (
    spec != null &&
    input?.type === "chooseAction" &&
    spec.action.promptActionOverride == null &&
    !spec.action.isWaitingForResponse &&
    !usePromptPreferencesStore.getState().fullControl &&
    input.actions.every((action) => action.type === "activateAbility" && action.isManaAbility)
  );
}

function sameArray<T>(
  left: readonly T[],
  right: readonly T[],
  equal: (leftValue: T, rightValue: T) => boolean = Object.is,
): boolean {
  return (
    left === right ||
    (left.length === right.length && left.every((value, index) => equal(value, right[index]!)))
  );
}

function sameRecord(left: Record<string, number>, right: Record<string, number>): boolean {
  if (left === right) return true;
  const leftKeys = Object.keys(left);
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function samePayManaInfo(
  left: PromptOverlaySpec["action"]["payManaCostInfo"],
  right: PromptOverlaySpec["action"]["payManaCostInfo"],
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.cardName === right.cardName &&
    left.sourceCard === right.sourceCard &&
    left.manaCost === right.manaCost &&
    left.description === right.description &&
    sameRecord(left.manaPool, right.manaPool) &&
    left.canConfirmFromPool === right.canConfirmFromPool &&
    left.delveCount === right.delveCount &&
    left.delveAvailable === right.delveAvailable &&
    !!left.onOpenDelve === !!right.onOpenDelve &&
    left.lifeToPay === right.lifeToPay &&
    !!left.onPayLife === !!right.onPayLife
  );
}

function sameActionPresentation(
  left: PromptOverlaySpec["action"],
  right: PromptOverlaySpec["action"],
): boolean {
  return (
    left === right ||
    (left.promptType === right.promptType &&
      left.promptActionOverride === right.promptActionOverride &&
      left.isWaitingForResponse === right.isWaitingForResponse &&
      left.isWaitingForOthers === right.isWaitingForOthers &&
      sameArray(left.availableAttackerIds, right.availableAttackerIds) &&
      sameArray(left.pendingAttackers, right.pendingAttackers) &&
      left.selectedAttackDefenderId === right.selectedAttackDefenderId &&
      left.multipleAttackDefenders === right.multipleAttackDefenders &&
      left.attackAssignmentCount === right.attackAssignmentCount &&
      left.mustAttackHint === right.mustAttackHint &&
      left.pendingAttacker === right.pendingAttacker &&
      left.pendingBlocker === right.pendingBlocker &&
      left.blockError === right.blockError &&
      left.blockRequirementError === right.blockRequirementError &&
      left.blockRestrictionHint === right.blockRestrictionHint &&
      sameArray(left.attackerIds, right.attackerIds) &&
      sameArray(
        left.blockAssignments,
        right.blockAssignments,
        (a, b) => a.blockerId === b.blockerId && a.attackerId === b.attackerId,
      ) &&
      sameArray(
        left.combatPairings,
        right.combatPairings,
        (a, b) =>
          a.key === b.key &&
          a.attacker === b.attacker &&
          a.defender === b.defender &&
          a.count === b.count,
      ) &&
      left.combatDefenderLife === right.combatDefenderLife &&
      left.damageOrderCount === right.damageOrderCount &&
      left.damageOrderTotal === right.damageOrderTotal &&
      left.targetCompletionLabel === right.targetCompletionLabel &&
      left.targetCompletionKind === right.targetCompletionKind &&
      !!left.onCompleteTargets === !!right.onCompleteTargets &&
      !!left.onOpenCombat === !!right.onOpenCombat &&
      left.isMyTurn === right.isMyTurn &&
      samePayManaInfo(left.payManaCostInfo, right.payManaCostInfo) &&
      left.mulliganCount === right.mulliganCount &&
      !!left.onMulliganKeep === !!right.onMulliganKeep &&
      !!left.onMulliganDraw === !!right.onMulliganDraw &&
      left.mulliganPutBackCount === right.mulliganPutBackCount &&
      left.mulliganSelectedCount === right.mulliganSelectedCount &&
      !!left.onMulliganPutBackConfirm === !!right.onMulliganPutBackConfirm &&
      left.selfClusterMaxHeight === right.selfClusterMaxHeight &&
      left.dividerY === right.dividerY &&
      left.dimmed === right.dimmed)
  );
}
export function sameGameOverPresentation(
  left: PromptOverlaySpec["gameOver"] | undefined,
  right: PromptOverlaySpec["gameOver"] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.winnerId === right.winnerId &&
    left.me === right.me &&
    sameArray(left.opponents, right.opponents) &&
    left.turn === right.turn
  );
}

export function samePromptPresentation(
  left: PromptOverlaySpec | null,
  right: PromptOverlaySpec | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (
    left.currentPrompt !== right.currentPrompt ||
    left.gameView !== right.gameView ||
    left.sourceDeckCard !== right.sourceDeckCard ||
    left.modalHidden !== right.modalHidden ||
    !sameActionPresentation(left.action, right.action)
  ) {
    return false;
  }
  if (left.damageOrder !== right.damageOrder) {
    if (!left.damageOrder || !right.damageOrder) return false;
    if (
      left.damageOrder.attackerName !== right.damageOrder.attackerName ||
      !sameArray(left.damageOrder.blockerCards, right.damageOrder.blockerCards) ||
      !sameArray(left.damageOrder.order, right.damageOrder.order)
    ) {
      return false;
    }
  }
  if (!sameGameOverPresentation(left.gameOver, right.gameOver)) return false;
  return true;
}

export abstract class PromptLayerBase {
  readonly container = new Container();
  protected readonly app: Application;
  protected theme: Theme;
  protected readonly callbacks: PromptLayerCallbacks;
  protected spec: PromptOverlaySpec | null = null;
  protected viewportWidth = 0;
  protected viewportHeight = 0;
  protected actionBounds: Rectangle | null = null;
  protected modalOpen = false;
  protected selectedIds = new Set<string>();
  protected counts = new Map<number | string, number>();
  protected numberValue = 0;
  protected numberBuffer = "";
  protected order: string[] = [];
  protected scryItems: Record<string, string[]> = {};
  protected scrySelectedId: string | null = null;
  protected scryPoolScrollOffset = 0;
  protected scryPoolScrollMax = 0;
  protected scryPoolScrollToEnd = false;
  protected scryPoolSlotX = new Map<string, number>();
  protected damageAssigned: Record<string, number> = {};
  protected dropZones: DropZone[] = [];
  protected drag: DragState | null = null;
  protected suppressedTapItems = new WeakSet<Container>();
  protected scryCardTiles = new Map<string, Container>();
  protected scryCardOffsets = new Map<string, { x: number; y: number }>();
  protected scryPreviousPositions = new Map<string, { x: number; y: number }>();
  protected reorderCardVisuals = new Map<
    string,
    {
      tile: Container;
      controls: Container;
      slotOffsetX: number;
      slotOffsetY: number;
      controlsOffsetX: number;
      controlsOffsetY: number;
      rank: Graphics;
      rankText: Text;
      cardName: string;
    }
  >();
  protected reorderPreviousPositions = new Map<string, { x: number; y: number }>();
  protected reorderPreview: { cardId: string; index: number | null } | null = null;
  protected promptCardStates = new Map<string, PromptCardDisplayState>();
  protected activePromptCard: { card: CardDto; sprite: CardSprite } | null = null;
  protected activePromptCardId: string | null = null;
  protected rollElapsedMs = 0;
  protected rollDurationMs = 0;
  protected rollHighlightLabel: string | null = null;
  protected autopassRemainingMs: number | null = null;
  protected rollVisuals: RollVisual[] = [];
  protected rollHighlightText: Text | null = null;
  protected rollConfirm: PromptButton | null = null;
  protected rollTimeline: gsap.core.Timeline | null = null;
  protected rollSettled = false;
  protected autopassTotalMs = 0;
  protected autopassFill: Graphics | null = null;
  protected actionPromptType: PromptOverlaySpec["action"]["promptType"] = undefined;
  protected endTurnModifiersHeld = false;
  protected actionContextOpen = false;
  protected actionGlow: PromptGlow | null = null;
  protected actionFeedback = { glow: 0, press: 0 };
  protected actionGlowTween: gsap.core.Timeline | null = null;
  protected actionFeedbackEndTurn = false;
  protected priorityButtons: { pass: PromptButton; end: PromptButton | null } | null = null;
  protected actionPulseNodes: Array<{ node: Container; maxAlpha: number }> = [];
  protected waitingTimeline: gsap.core.Timeline | null = null;
  protected waitingAnimationActive = false;
  protected entranceKey: object | string | null = null;
  protected entranceTween: gsap.core.Tween | null = null;
  protected actionLongPress = new LongPressGesture();
  protected selectionFilter = "";
  protected selectionFilterFocused = false;
  protected selectionFilterBlinkAt = 0;
  protected selectionFilterView: {
    container: Container;
    background: Graphics;
    caret: Graphics;
    width: number;
    y: number;
  } | null = null;
  protected modalScrollOffset = 0;
  protected modalScrollMax = 0;
  protected modalBody: {
    panel: Container;
    panelBackground: Graphics;
    body: Container;
    bodyTop: number;
    width: number;
    height: number;
    hitWidth: number;
    externalSourceHeight: number;
    footerHeight: number;
    footerContentHeight: number;
    footer: Container;
    footerBackground: Graphics | null;
    mask: Graphics;
    viewportHeight: number;
    scrollTrack: Graphics;
    scrollThumb: Graphics;
  } | null = null;

  protected constructor(app: Application, callbacks: PromptLayerCallbacks = {}) {
    this.app = app;
    this.callbacks = callbacks;
    this.theme = getTheme();
    this.container.sortableChildren = true;
    this.container.zIndex = 10000;
    this.container.eventMode = "passive";
    this.app.stage.addChild(this.container);
  }

  protected panel(width: number, height: number, x: number, y: number, radius = 12): Container {
    const panel = new Container();
    panel.position.set(x, y);
    const background = new Graphics()
      .roundRect(0, 0, width, height, radius)
      .fill({ color: hexToNum(this.theme.appTheme.card), alpha: 0.97 })
      .stroke({ color: hexToNum(this.theme.appTheme.border), width: 1, alpha: 0.9 });
    background.eventMode = "none";
    panel.addChild(background);
    return panel;
  }

  protected addButtonRow(
    parent: Container,
    buttons: PromptButton[],
    y: number,
    availableWidth: number,
    align: "left" | "center" | "right" = "center",
  ): number {
    if (buttons.length === 0) return 0;
    const rawTotal =
      buttons.reduce((sum, button) => sum + button.buttonWidth, 0) + ROW_GAP * (buttons.length - 1);
    const scale = Math.min(1, availableWidth / rawTotal);
    const total = rawTotal * scale;
    let x =
      align === "left"
        ? 0
        : align === "right"
          ? availableWidth - total
          : (availableWidth - total) / 2;
    for (const button of buttons) {
      button.scale.set(scale);
      button.position.set(x, y);
      parent.addChild(button);
      x += (button.buttonWidth + ROW_GAP) * scale;
    }
    return buttons.reduce((height, button) => Math.max(height, button.buttonHeight * scale), 0);
  }

  protected makeButton(
    label: string,
    onPress: (() => void) | undefined,
    options: Omit<PromptButtonOptions, "label" | "onPress"> = {},
  ): PromptButton {
    return new PromptButton(this.theme, {
      label,
      onPress,
      ...options,
    });
  }

  protected makeIcon(name: string, size: number, color: string): Sprite {
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    sprite.tint = hexToNum(color);
    void gameIconTexture(name)
      .then((texture) => {
        if (sprite.destroyed) return;
        sprite.texture = texture;
        sprite.width = size;
        sprite.height = size;
      })
      .catch(() => {});
    return sprite;
  }

  protected manaSymbol(color: string): string {
    switch (color) {
      case "White":
      case "W":
        return "W";
      case "Blue":
      case "U":
        return "U";
      case "Black":
      case "B":
        return "B";
      case "Red":
      case "R":
        return "R";
      case "Green":
      case "G":
        return "G";
      case "Colorless":
      case "C":
        return "C";
      default:
        return "C";
    }
  }

  protected makeManaIcon(symbol: string, size: number): Sprite {
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    void loadManaSymbolTexture(symbol)
      .then((texture) => {
        if (sprite.destroyed) return;
        sprite.texture = texture;
        sprite.width = size;
        sprite.height = size;
      })
      .catch(() => {});
    return sprite;
  }
  protected promptSourceCard(): CardDto | null {
    const promptSource = this.spec?.currentPrompt?.sourceCard;
    if (promptSource) return promptSource;
    const deckSource = this.spec?.sourceDeckCard;
    return deckSource ? deckCardToPreviewDto(deckSource) : null;
  }
  protected promptCardDimensions(maxHeight = Number.POSITIVE_INFINITY): {
    width: number;
    height: number;
  } {
    return fitPromptCardDimensions(
      this.viewportWidth - PANEL_PADDING * 2 - 24,
      this.viewportHeight,
      maxHeight,
    );
  }

  protected promptCardDisplayDimensions(
    card: CardDto,
    portraitWidth: number,
  ): { width: number; height: number } {
    const state = this.promptCardState(card);
    return getPromptCardDisplayDimensions(
      card,
      portraitWidth,
      state.face,
      !state.horizontalFlipped,
    );
  }

  protected promptSourceCardDimensions(): {
    width: number;
    height: number;
  } {
    const availableHeight = Math.max(112, this.viewportHeight - 24 - SOURCE_LABEL_HEIGHT);
    const width = Math.min(
      GAME_CARD_SIZES.preview.width,
      (availableHeight * CARD_W) / CARD_H,
      Math.max(80, this.viewportWidth - PANEL_PADDING * 2 - 24),
    );
    return { width, height: width * CARD_ASPECT_RATIO };
  }

  protected modalPromptWidth(maxWidth: number): number {
    const viewportWidth = this.viewportWidth - 24;
    const sourceCard = this.promptSourceCard();
    if (!sourceCard) return Math.min(maxWidth, viewportWidth);
    const sourceWidth = this.promptCardDisplayDimensions(
      sourceCard,
      this.promptSourceCardDimensions().width,
    ).width;
    const widthWithSourceCard = viewportWidth - sourceWidth - SOURCE_CARD_GAP;
    return widthWithSourceCard >= 320
      ? Math.min(maxWidth, widthWithSourceCard)
      : Math.min(maxWidth, viewportWidth);
  }

  protected promptCardState(card: CardDto): PromptCardDisplayState {
    let state = this.promptCardStates.get(card.id);
    if (!state) {
      state = {
        rulesView: usePreferencesStore.getState().promptCardStyle === "rules",
        face: card.isTransformed ? 1 : 0,
        horizontalFlipped: true,
      };
      this.promptCardStates.set(card.id, state);
    }
    return state;
  }

  protected configurePromptCardSprite(sprite: CardSprite, card: CardDto): void {
    sprite.onVisualChange = this.callbacks.onRenderRequested;
    const state = this.promptCardState(card);
    sprite.setPreviewFace(state.face);
    sprite.setHandRulesView(state.rulesView);
    const horizontal = sprite.horizontalFrame && !card.isDoubleFaced;
    sprite.setHandControls({
      rulesView: state.rulesView,
      horizontal,
      alternateFace: horizontal ? state.horizontalFlipped : state.face === 1,
      showFaceControl: horizontal || card.isDoubleFaced,
      onToggleRules: () => this.togglePromptCardView(card, sprite),
      onToggleFace: () => this.togglePromptCardFace(card, sprite),
    });
    sprite.onReorient?.();
  }

  protected togglePromptCardView(card: CardDto, sprite: CardSprite): void {
    const state = this.promptCardState(card);
    state.rulesView = !state.rulesView;
    this.configurePromptCardSprite(sprite, card);
  }

  protected togglePromptCardFace(card: CardDto, sprite: CardSprite): void {
    const state = this.promptCardState(card);
    if (card.isDoubleFaced) state.face = state.face === 0 ? 1 : 0;
    else if (sprite.horizontalFrame) state.horizontalFlipped = !state.horizontalFlipped;
    else return;
    this.rebuild();
  }

  protected bindPromptCardActivation(
    target: Container,
    card: CardDto,
    sprite: CardSprite,
    actionable: boolean,
  ): void {
    let restingZIndex: number | null = null;
    const hoverTarget = actionable ? sprite : target;
    if (!actionable && target !== sprite && target.hitArea instanceof Rectangle) {
      target.origin.set(
        target.hitArea.x + target.hitArea.width / 2,
        target.hitArea.y + target.hitArea.height / 2,
      );
    }
    const scale = hoverTarget.scale;
    let restingScaleX = scale.x;
    let restingScaleY = scale.y;
    let passiveHovered = false;
    const syncPassiveScale = (hovered: boolean, animate = true) => {
      const scaleX = restingScaleX * (hovered ? PASSIVE_CARD_HOVER_SCALE : 1);
      const scaleY = restingScaleY * (hovered ? PASSIVE_CARD_HOVER_SCALE : 1);
      gsap.killTweensOf(scale);
      if (!animate || !animationsEnabled()) {
        scale.set(scaleX, scaleY);
        return;
      }
      gsap.to(scale, {
        x: scaleX,
        y: scaleY,
        duration: CARD_HOVER_TRANSITION_SECONDS,
        ease: "power2.out",
        overwrite: true,
      });
    };
    if (!actionable && hoverTarget === sprite && sprite.onReorient) {
      const placeSprite = sprite.onReorient;
      sprite.onReorient = () => {
        placeSprite();
        restingScaleX = scale.x;
        restingScaleY = scale.y;
        if (passiveHovered) syncPassiveScale(true, false);
      };
    }
    sprite.once("destroyed", () => gsap.killTweensOf(scale));
    const showFeedback = () => {
      if (actionable) {
        sprite.setElevation(1);
        sprite.setRing(hexToNum(this.theme.gameTheme.cardRing));
      } else if (!passiveHovered) {
        restingScaleX = scale.x;
        restingScaleY = scale.y;
        passiveHovered = true;
        syncPassiveScale(true);
      }
      this.callbacks.onRenderRequested?.();
    };
    const hideFeedback = () => {
      if (actionable) {
        sprite.setElevation(0);
        sprite.setRing(null);
      } else if (passiveHovered) {
        passiveHovered = false;
        syncPassiveScale(false);
      }
      this.callbacks.onRenderRequested?.();
    };
    const activate = () => {
      restingZIndex ??= target.zIndex;
      if (this.drag?.item !== target || !this.drag.hasMoved) target.zIndex = CARD_HOVER_Z_INDEX;
      this.activePromptCardId = card.id;
      this.activePromptCard = { card, sprite };
      showFeedback();
    };
    const deactivate = () => {
      if (restingZIndex !== null) {
        if (this.drag?.item !== target || !this.drag.hasMoved) target.zIndex = restingZIndex;
        restingZIndex = null;
      }
      hideFeedback();
      if (this.activePromptCard?.sprite !== sprite) return;
      this.activePromptCardId = null;
      this.activePromptCard = null;
    };
    if (this.activePromptCardId === card.id) {
      this.activePromptCard = { card, sprite };
      showFeedback();
    }
    target.on("pointerenter", activate);
    target.on("pointerleave", deactivate);
    target.on("pointerdowncapture", activate);
    target.on("focusin", activate);
    target.on("focusout", deactivate);
  }

  hitTestRules(x: number, y: number): boolean {
    return this.rulesSpriteAt(x, y) !== null;
  }

  scrollRulesAt(x: number, y: number, delta: number, mode: number): boolean {
    return this.rulesSpriteAt(x, y)?.scrollHandRules(delta, mode) ?? false;
  }

  private rulesSpriteAt(x: number, y: number): CardSprite | null {
    if (!this.modalOpen || !this.container.visible || this.drag?.hasMoved) return null;
    let target: Container | null = this.app.renderer.events.rootBoundary.hitTest(x, y);
    let sprite: CardSprite | null = null;
    while (target && target !== this.container) {
      if (target instanceof CardSprite && target.usesHandRulesView) sprite = target;
      target = target.parent;
    }
    return target === this.container ? sprite : null;
  }

  protected handlePromptCardShortcut(event: KeyboardEvent): boolean {
    const active = this.activePromptCard;
    const pressed = comboFromEvent(event);
    if (!active || !pressed) return false;
    const overrides = useKeybindingsStore.getState().overrides;
    const viewCombo = resolveCombo("toggle-card-view", overrides);
    if (viewCombo && combosMatch(pressed, viewCombo)) {
      this.togglePromptCardView(active.card, active.sprite);
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }
    const flipCombo = resolveCombo("flip-card", overrides);
    if (
      (!active.card.isDoubleFaced && !active.sprite.horizontalFrame) ||
      !flipCombo ||
      !combosMatch(pressed, flipCombo)
    ) {
      return false;
    }
    this.togglePromptCardFace(active.card, active.sprite);
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  protected promptCardShortcutHint(): string {
    const overrides = useKeybindingsStore.getState().overrides;
    const viewCombo = resolveCombo("toggle-card-view", overrides);
    const flipCombo = resolveCombo("flip-card", overrides);
    return [
      viewCombo ? `${formatCombo(viewCombo)} changes view` : null,
      flipCombo ? `${formatCombo(flipCombo)} flips or rotates card` : null,
    ]
      .filter((entry): entry is string => entry != null)
      .join(" · ");
  }
  protected findDropZone(x: number, y: number): DropZone | undefined {
    return this.dropZones.find((zone) => {
      const point = zone.container.toLocal({ x, y });
      return zone.rect.contains(point.x, point.y);
    });
  }
  protected makeDraggable(
    item: Container,
    onDrop: (x: number, y: number) => void,
    resolveDropPosition?: (x: number, y: number) => { x: number; y: number } | null,
    onDragMove?: (x: number, y: number) => void,
  ): void {
    item.eventMode = "static";
    item.cursor = "grab";
    item.on("pointerdown", (event: FederatedPointerEvent) => {
      const parent = item.parent;
      if (!parent || this.drag || event.button !== 0) return;
      gsap.killTweensOf(item);
      gsap.killTweensOf(item.position);
      gsap.killTweensOf(item.scale);
      const point = parent.toLocal(event.global);
      const bounds =
        item.hitArea instanceof Rectangle ? item.hitArea : item.getLocalBounds().rectangle;
      const ring = new Graphics()
        .roundRect(
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          (CARD_RADIUS * bounds.width) / CARD_W,
        )
        .stroke({ color: hexToNum(this.theme.gameTheme.cardRing), width: 4 });
      ring.eventMode = "none";
      ring.alpha = 0;
      item.addChild(ring);
      this.drag = {
        item,
        pointerId: event.pointerId,
        startGlobalX: event.global.x,
        startGlobalY: event.global.y,
        originX: item.x,
        originY: item.y,
        offsetX: point.x - item.x,
        offsetY: point.y - item.y,
        targetX: item.x,
        targetY: item.y,
        settling: false,
        hasMoved: false,
        restRotation: item.rotation,
        restScaleX: item.scale.x,
        restScaleY: item.scale.y,
        restOriginX: item.origin.x,
        restOriginY: item.origin.y,
        lastGlobalX: event.global.x,
        targetRotation: item.rotation,
        settleProgress: 0,
        settleTween: null,
        ring,
        renderLayer: null,
        onDrop,
        resolveDropPosition,
        onDragMove,
      };
      item.origin.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      event.stopPropagation();
    });
  }

  protected startDragFeedback(drag: DragState): void {
    drag.hasMoved = true;
    drag.item.cursor = "grabbing";
    drag.item.alpha = 1;
    const renderLayer = new RenderLayer();
    renderLayer.zIndex = DRAG_LAYER_Z_INDEX;
    renderLayer.eventMode = "none";
    this.container.addChild(renderLayer);
    renderLayer.attach(drag.item);
    drag.renderLayer = renderLayer;
  }

  protected moveDrag(event: FederatedPointerEvent): void {
    const drag = this.drag;
    const parent = drag?.item.parent;
    if (!drag || !parent || drag.settling || event.pointerId !== drag.pointerId) return;
    if (
      !drag.hasMoved &&
      Math.hypot(event.global.x - drag.startGlobalX, event.global.y - drag.startGlobalY) <
        DRAG_START_THRESHOLD
    ) {
      return;
    }
    if (!drag.hasMoved) this.startDragFeedback(drag);
    const parentPoint = parent.toLocal(event.global);
    drag.targetX = parentPoint.x - drag.offsetX;
    drag.targetY = parentPoint.y - drag.offsetY;
    const movementX = event.global.x - drag.lastGlobalX;
    drag.lastGlobalX = event.global.x;
    drag.targetRotation = drag.restRotation + dragTiltForMovement(movementX);
    if (!animationsEnabled()) {
      drag.item.position.set(drag.targetX, drag.targetY);
      drag.item.rotation = drag.targetRotation;
      drag.item.scale.set(drag.restScaleX * DRAG_LIFT_SCALE, drag.restScaleY * DRAG_LIFT_SCALE);
      drag.ring.alpha = 1;
    }
    this.setDropZoneHighlight(event.global.x, event.global.y);
    drag.onDragMove?.(event.global.x, event.global.y);
  }

  protected updateDragMotion(deltaMs: number): void {
    const drag = this.drag;
    if (!drag?.hasMoved || drag.settling || !animationsEnabled()) return;
    const positionBlend = dragPositionBlend(deltaMs);
    const transformBlend = dragTransformBlend(deltaMs);
    drag.item.position.set(
      drag.item.x + (drag.targetX - drag.item.x) * positionBlend,
      drag.item.y + (drag.targetY - drag.item.y) * positionBlend,
    );
    drag.item.scale.set(
      drag.item.scale.x + (drag.restScaleX * DRAG_LIFT_SCALE - drag.item.scale.x) * transformBlend,
      drag.item.scale.y + (drag.restScaleY * DRAG_LIFT_SCALE - drag.item.scale.y) * transformBlend,
    );
    drag.item.rotation += (drag.targetRotation - drag.item.rotation) * transformBlend;
    drag.ring.alpha += (1 - drag.ring.alpha) * transformBlend;
    drag.targetRotation =
      drag.restRotation + (drag.targetRotation - drag.restRotation) * (1 - transformBlend);
  }

  protected finishDrag(event: FederatedPointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.settling || event.pointerId !== drag.pointerId) return;
    if (!drag.hasMoved) {
      this.drag = null;
      this.completeDragVisual(drag, { x: drag.originX, y: drag.originY });
      return;
    }
    this.suppressedTapItems.add(drag.item);
    const dropPosition = drag.resolveDropPosition?.(event.global.x, event.global.y);
    const destination = drag.resolveDropPosition
      ? (dropPosition ?? { x: drag.originX, y: drag.originY })
      : { x: drag.item.x, y: drag.item.y };
    const releaseX = event.global.x;
    const releaseY = event.global.y;
    if (!animationsEnabled()) {
      this.completeDragVisual(drag, destination);
      this.resetDropZones();
      this.drag = null;
      drag.onDrop(releaseX, releaseY);
      return;
    }
    const distance = Math.hypot(destination.x - drag.item.x, destination.y - drag.item.y);
    const duration = Math.min(
      DRAG_DROP_MAX_SECONDS,
      Math.max(DRAG_DROP_MIN_SECONDS, distance / DRAG_DROP_PIXELS_PER_SECOND),
    );
    drag.settling = true;
    drag.item.cursor = "default";
    drag.item.eventMode = "none";
    this.setDropZoneHighlight(releaseX, releaseY);
    this.animateDragRelease(drag, destination, duration, () => {
      if (this.drag !== drag) return;
      this.resetDropZones();
      this.drag = null;
      drag.onDrop(releaseX, releaseY);
    });
  }

  protected animateDragRelease(
    drag: DragState,
    destination: { x: number; y: number },
    duration: number,
    onComplete: () => void,
  ): void {
    const startX = drag.item.x;
    const startY = drag.item.y;
    const startScaleX = drag.item.scale.x;
    const startScaleY = drag.item.scale.y;
    const startRotation = drag.item.rotation;
    const startRingAlpha = drag.ring.alpha;
    drag.settleProgress = 0;
    drag.settleTween = gsap.to(drag, {
      settleProgress: 1,
      duration,
      ease: "power3.out",
      onUpdate: () => {
        const progress = drag.settleProgress;
        drag.item.position.set(
          startX + (destination.x - startX) * progress,
          startY + (destination.y - startY) * progress,
        );
        drag.item.scale.set(
          startScaleX + (drag.restScaleX - startScaleX) * progress,
          startScaleY + (drag.restScaleY - startScaleY) * progress,
        );
        drag.item.rotation = startRotation + (drag.restRotation - startRotation) * progress;
        drag.ring.alpha = startRingAlpha * (1 - progress);
      },
      onComplete: () => {
        drag.settleTween = null;
        this.completeDragVisual(drag, destination);
        onComplete();
      },
    });
  }

  protected completeDragVisual(drag: DragState, destination: { x: number; y: number }): void {
    drag.settleTween?.kill();
    drag.settleTween = null;
    drag.item.position.set(destination.x, destination.y);
    drag.item.rotation = drag.restRotation;
    drag.item.scale.set(drag.restScaleX, drag.restScaleY);
    drag.item.origin.set(drag.restOriginX, drag.restOriginY);
    drag.item.cursor = "grab";
    drag.item.eventMode = "static";
    drag.item.alpha = 1;
    if (drag.renderLayer) {
      drag.renderLayer.detach(drag.item);
      drag.renderLayer.destroy();
      drag.renderLayer = null;
    }
    if (!drag.ring.destroyed) drag.ring.destroy();
  }

  protected setDropZoneHighlight(x: number, y: number): void {
    const activeId = this.findDropZone(x, y)?.id;
    for (const zone of this.dropZones) {
      const active = zone.id === activeId;
      const alpha = active ? 1 : DROP_ZONE_DIM_ALPHA;
      if (zone.marker) zone.marker.visible = active;
      if (zone.targetAlpha === alpha) continue;
      zone.targetAlpha = alpha;
      if (!animationsEnabled()) {
        gsap.killTweensOf(zone.visual);
        zone.visual.alpha = alpha;
        continue;
      }
      gsap.to(zone.visual, {
        alpha,
        duration: DROP_ZONE_TWEEN_SECONDS,
        ease: "power2.out",
        overwrite: true,
      });
    }
  }

  protected resetDropZones(): void {
    for (const zone of this.dropZones) {
      gsap.killTweensOf(zone.visual);
      zone.targetAlpha = 1;
      zone.visual.alpha = 1;
      if (zone.marker) zone.marker.visible = false;
    }
  }

  protected cancelDrag(): void {
    const drag = this.drag;
    this.drag = null;
    if (drag) {
      this.completeDragVisual(drag, { x: drag.originX, y: drag.originY });
    }
    this.resetDropZones();
  }

  protected setSelectionFilterFocused(focused: boolean): void {
    this.selectionFilterFocused = focused;
    this.selectionFilterBlinkAt = performance.now();
    const filter = this.selectionFilterView;
    if (!filter) return;
    filter.background
      .clear()
      .roundRect(0, filter.y, filter.width, 40, 8)
      .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.72 })
      .stroke({
        color: hexToNum(focused ? this.theme.gameTheme.cardRing : this.theme.appTheme.border),
        width: focused ? 2 : 1,
        alpha: focused ? 0.9 : 1,
      });
    filter.caret.visible = focused;
  }

  protected abstract rebuild(): void;
}
