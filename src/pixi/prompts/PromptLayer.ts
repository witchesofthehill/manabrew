import {
  Application,
  Container,
  type FederatedWheelEvent,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  type Ticker,
} from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { CardSprite } from "@/pixi/CardSprite";
import { gameIconTexture } from "@/pixi/gameIconCache";
import { loadManaSymbolTexture } from "@/pixi/manaSymbolCache";
import { deckCardToPreviewDto } from "@/lib/scryfall.utils";
import {
  ACTION_DRAWER_BUMP_EVENT,
  AUTOPASS_DELAY_MAX_MS,
  AUTOPASS_DELAY_MIN_MS,
  CARD_H,
  CARD_W,
} from "@/components/game/game.constants";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { type PromptActionViewKey, useGameDevStore } from "@/stores/useGameDevStore";
import { resolveCombo, useKeybindingsStore } from "@/stores/useKeybindingsStore";
import {
  comboFromEvent,
  combosMatch,
  comboSymbols,
  formatCombo,
  normalizeCombo,
} from "@/lib/keybindings";
import { isCoarsePointer } from "@/lib/responsive";
import {
  ATTACK_DRAG_HINT,
  getPromptContextLines,
} from "@/components/game/panels/promptContextHints";
import type {
  CardDto,
  ChooseCombatDamageAssignmentInput,
  PromptPresentation,
  ReorderItem,
  ScryDestination,
  SelectionOption,
  TargetRef,
} from "@/protocol";
import { PromptButton, type PromptButtonOptions } from "./PromptButton";
import { LongPressGesture } from "@/pixi/LongPressGesture";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
import type { PromptLayerCallbacks, PromptOverlaySpec } from "./prompt.types";

const MODAL_TYPES = new Set([
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
const PANEL_PADDING = 20;
const ROW_GAP = 10;
const CARD_WIDTH = 240;
const CARD_TILE_EDGE_INSET = 8;
const REORDER_MODAL_VERTICAL_RESERVE = 280;
const REORDER_ORDER_ZONE_ID = "reorder-order";
const REORDER_CARD_INSET = 18;
const REORDER_LAYOUT_SETTLE_SECONDS = 0.24;
const REORDER_SNAP_PULSE_SECONDS = 0.34;
const CARD_ASPECT_RATIO = CARD_H / CARD_W;
const CARD_VERTICAL_RESERVE = 288;
const SCRY_BODY_VERTICAL_RESERVE = 176;
const CARD_MODAL_MAX_WIDTH = 1160;
const DICE_ROLL_MS = 1200;
const DICE_FINISH_MS = 1450;
const SOURCE_CARD_GAP = 20;
const SOURCE_CARD_MIN_EXTERNAL_WIDTH = 120;
const SOURCE_LABEL_HEIGHT = 18;
const DRAG_DROP_MIN_SECONDS = 0.1;
const DRAG_DROP_MAX_SECONDS = 0.22;
const DRAG_DROP_PIXELS_PER_SECOND = 1800;
const DROP_ZONE_DIM_ALPHA = 0.62;
const DROP_ZONE_TWEEN_SECONDS = 0.12;
const DRAG_LIFT_SCALE = 1.035;
const DRAG_MAX_TILT_RADIANS = (10 * Math.PI) / 180;
const DRAG_TILT_RADIANS_PER_PIXEL = 0.017;
const DRAG_FEEDBACK_SECONDS = 0.14;
const REORDER_PREVIEW_SECONDS = 0.14;
const SCRY_LAYOUT_SETTLE_SECONDS = 0.2;

interface DragState {
  item: Container;
  pointerId: number;
  originX: number;
  originY: number;
  offsetX: number;
  offsetY: number;
  settling: boolean;
  restRotation: number;
  restScaleX: number;
  restScaleY: number;
  restOriginX: number;
  restOriginY: number;
  lastGlobalX: number;
  ring: Graphics;
  onDrop: (x: number, y: number) => void;
  resolveDropPosition?: (x: number, y: number) => { x: number; y: number } | null;
  onDragMove?: (x: number, y: number) => void;
}

interface DiceVisual {
  die: Graphics;
  value: Text;
  finalValue: number;
  index: number;
  sides: number;
}
interface DropZone {
  id: string;
  rect: Rectangle;
  container: Container;
  visual: Graphics;
  dropX: number;
  dropY: number;
  targetAlpha: number;
}
interface PromptCardDisplayState {
  rulesView: boolean;
  face: 0 | 1;
}

function promptText(
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

function parseCombatNumber(value?: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface ActionViewLayout {
  container: Container;
  width: number;
  height: number;
}

function runtimeActionView(
  promptType: PromptOverlaySpec["action"]["promptType"],
): PromptActionViewKey {
  switch (promptType) {
    case undefined:
    case "gameOver":
    case "chooseDamageAssignmentOrder":
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

function promptTypeForView(
  promptType: PromptOverlaySpec["action"]["promptType"],
  override: PromptActionViewKey | null | undefined,
): PromptOverlaySpec["action"]["promptType"] {
  if (!override) return promptType;
  if (override === "chooseTargetSpell" || override === "promptLabel") return "chooseBoardTargets";
  if (override === "chooseDamageOrder") return "chooseDamageAssignmentOrder";
  if (override === "promptRequired" || override === "noAction") return undefined;
  return override;
}

function actionTitle(promptType: PromptOverlaySpec["action"]["promptType"]): string {
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

export class PromptLayer {
  readonly container = new Container();
  private readonly app: Application;
  private theme: Theme;
  private readonly callbacks: PromptLayerCallbacks;
  private spec: PromptOverlaySpec | null = null;
  private promptKey: unknown = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private actionBounds: Rectangle | null = null;
  private modalOpen = false;
  private selectedIds = new Set<string>();
  private counts = new Map<number | string, number>();
  private numberValue = 0;
  private numberBuffer = "";
  private order: string[] = [];
  private scryItems: Record<string, string[]> = {};
  private scrySelectedId: string | null = null;
  private damageAssigned: Record<string, number> = {};
  private dropZones: DropZone[] = [];
  private drag: DragState | null = null;
  private scryCardTiles = new Map<string, Container>();
  private scryPreviousPositions = new Map<string, { x: number; y: number }>();
  private reorderCardVisuals = new Map<
    string,
    {
      tile: Container;
      controls: Container;
      controlsOffsetX: number;
      controlsOffsetY: number;
    }
  >();
  private reorderPreviousPositions = new Map<string, { x: number; y: number }>();
  private reorderSettledCardId: string | null = null;
  private reorderPreview: { cardId: string; index: number | null } | null = null;
  private promptCardStates = new Map<string, PromptCardDisplayState>();
  private activePromptCard: { card: CardDto; sprite: CardSprite } | null = null;
  private activePromptCardId: string | null = null;
  private diceElapsedMs = 0;
  private autopassRemainingMs: number | null = null;
  private diceVisuals: DiceVisual[] = [];
  private diceWinnerText: Text | null = null;
  private diceConfirm: PromptButton | null = null;
  private diceSettled = false;
  private autopassTotalMs = 0;
  private autopassFill: Graphics | null = null;
  private actionPromptType: PromptOverlaySpec["action"]["promptType"] = undefined;
  private readonly unsubscribePromptPreferences: () => void;
  private readonly unsubscribePreferences: () => void;
  private readonly unsubscribeKeybindings: () => void;
  private endTurnModifiersHeld = false;
  private actionContextOpen = false;
  private combatBreakdownOpen = false;
  private actionPanel: Container | null = null;
  private actionPanelHeight = 0;
  private actionGlow: [Graphics, Graphics, Graphics, Graphics] | null = null;
  private actionPulseNodes: Array<{ node: Container; maxAlpha: number }> = [];
  private actionHourglass: Sprite | null = null;
  private actionLongPress = new LongPressGesture();
  private selectionFilter = "";
  private modalScrollOffset = 0;
  private modalScrollMax = 0;
  private modalBody: { body: Container; bodyTop: number; height: number } | null = null;
  private keyListener: (event: KeyboardEvent) => void;
  private onStageMove = (event: FederatedPointerEvent): void => this.moveDrag(event);
  private onStageUp = (event: FederatedPointerEvent): void => this.finishDrag(event);
  private onStageCancel = (event: FederatedPointerEvent): void => this.cancelPointerDrag(event);
  private onModifierEvent = (event: KeyboardEvent | PointerEvent): void =>
    this.updateEndTurnModifiers(event);
  private onModifierReset = (): void => this.setEndTurnModifiersHeld(false);
  private onActionBump = (): void => this.bumpActionPanel();
  private readonly onTick = (ticker: Ticker): void => this.update(ticker.deltaMS);

  constructor(app: Application, callbacks: PromptLayerCallbacks = {}) {
    this.app = app;
    this.callbacks = callbacks;
    this.theme = getTheme();
    this.container.sortableChildren = true;
    this.container.zIndex = 10000;
    this.container.eventMode = "passive";
    this.app.stage.addChild(this.container);
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
    const nextActionPromptType = spec?.action.promptType;
    if (nextActionPromptType !== this.actionPromptType) {
      this.actionPromptType = nextActionPromptType;
      this.combatBreakdownOpen = false;
      this.actionContextOpen = false;
    }
    const nextKey = spec?.currentPrompt ?? spec?.gameOver ?? null;
    const promptChanged = nextKey !== this.promptKey;
    if (promptChanged) {
      this.promptKey = nextKey;
      this.resetLocalState(spec);
      if (spec?.currentPrompt && MODAL_TYPES.has(spec.currentPrompt.input.type)) {
        spec.onShowModal();
      }
    }
    this.spec = spec;
    const modalUnavailable = !!spec?.modalHidden || !!spec?.action.isWaitingForResponse;
    if (this.drag && !promptChanged && !modalUnavailable) return;
    this.rebuild();
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
    this.clearScryCardTiles();
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
    this.reorderSettledCardId = null;
    this.reorderPreview = null;
    this.diceVisuals = [];
    this.diceWinnerText = null;
    this.diceConfirm = null;
    this.diceSettled = false;
    this.diceElapsedMs = 0;
    this.modalScrollOffset = 0;
    this.modalScrollMax = 0;
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
    if (
      input.type === "chooseAction" &&
      spec.gameView.stack.length === 0 &&
      !usePromptPreferencesStore.getState().fullControl &&
      input.actions.every((action) => action.type === "activateAbility" && action.isManaAbility)
    ) {
      this.autopassTotalMs =
        AUTOPASS_DELAY_MIN_MS + Math.random() * (AUTOPASS_DELAY_MAX_MS - AUTOPASS_DELAY_MIN_MS);
      this.autopassRemainingMs = this.autopassTotalMs;
    }
  }
  private rebuild(): void {
    this.activePromptCard = null;
    this.callbacks.onReferenceChange?.(null);
    this.cancelDrag();
    this.dropZones = [];
    this.clearScryCardTiles();
    this.clearReorderCardVisuals();
    this.actionBounds = null;
    this.autopassFill = null;
    this.actionPanel = null;
    this.actionPanelHeight = 0;
    this.actionGlow = null;
    this.actionPulseNodes = [];
    this.actionHourglass = null;
    this.modalOpen = false;
    this.modalBody = null;
    this.container.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (!this.spec || this.viewportWidth <= 0 || this.viewportHeight <= 0) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    if (this.spec.gameOver) {
      this.modalOpen = true;
      this.renderGameOver();
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
      return;
    }
    this.renderActionPanel();
  }

  private panel(width: number, height: number, x: number, y: number, radius = 12): Container {
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

  private addButtonRow(
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

  private makeButton(
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

  private makeIcon(name: string, size: number, color: string): Sprite {
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

  private manaSymbol(color: string): string {
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

  private makeManaIcon(symbol: string, size: number): Sprite {
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
  private renderActionPanel(): void {
    const spec = this.spec!;
    const action = spec.action;
    const shortScreen = this.viewportHeight <= 520;
    const touch = isCoarsePointer();
    const minimal = shortScreen && touch;
    if (
      action.promptType === "gameOver" ||
      !action.selfClusterMaxHeight ||
      action.selfClusterMaxHeight <= 0 ||
      (minimal && action.dimmed)
    ) {
      this.container.visible = false;
      return;
    }

    const runtimeView = action.isWaitingForOthers
      ? "noAction"
      : runtimeActionView(action.promptType);
    const viewKey = action.promptActionOverride ?? runtimeView;
    const effectivePromptType = promptTypeForView(action.promptType, action.promptActionOverride);
    const preview = action.promptActionOverride != null;
    const isNoActionView = action.promptActionOverride
      ? viewKey === "noAction"
      : !action.promptType || action.isWaitingForOthers;
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
          : this.theme.gameTheme.activeAction.priority;
      const softGlow = new Graphics()
        .roundRect(-6, -6, width + 12, panelHeight + 12, radius + 6)
        .stroke({ color: hexToNum(glowColor), width: 12 });
      softGlow.alpha = 0.3;
      const strongSoftGlow = new Graphics()
        .roundRect(-11, -11, width + 22, panelHeight + 22, radius + 11)
        .stroke({ color: hexToNum(glowColor), width: 22 });
      strongSoftGlow.alpha = 0;
      const ringGlow = new Graphics()
        .roundRect(-2, -2, width + 4, panelHeight + 4, radius + 2)
        .stroke({ color: hexToNum(glowColor), width: 2 });
      ringGlow.alpha = 0.75;
      const strongRingGlow = new Graphics()
        .roundRect(-3, -3, width + 6, panelHeight + 6, radius + 3)
        .stroke({ color: hexToNum(glowColor), width: 3 });
      strongRingGlow.alpha = 0;
      for (const glow of [softGlow, strongSoftGlow, ringGlow, strongRingGlow]) {
        glow.eventMode = "none";
      }
      panel.addChild(softGlow, strongSoftGlow, ringGlow, strongRingGlow);
      this.actionGlow = [softGlow, strongSoftGlow, ringGlow, strongRingGlow];
    }

    const background = this.makeActionPanelSurface(width, panelHeight, radius, squareBottom);
    panel.addChild(background);

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
    if (combat) {
      combat.container.position.set(sectionPaddingX, contentY);
      panel.addChild(combat.container);
      contentY += combat.height + contentGap;
    }
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
    this.actionPanel = panel;
    this.actionPanelHeight = panelHeight;
    this.actionBounds = new Rectangle(x, y, width, panelHeight);
    if (this.combatBreakdownOpen) this.renderCombatBreakdown();
  }

  private buildActionView(
    viewKey: PromptActionViewKey,
    availableWidth: number,
    minimal: boolean,
    touch: boolean,
    preview: boolean,
  ): ActionViewLayout {
    const action = this.spec!.action;
    const disabled = action.isWaitingForResponse || preview;
    const passColor = this.theme.gameTheme.promptAction.passAction;
    const attackColor = this.theme.gameTheme.promptAction.attackAction;
    const defenseColor = this.theme.gameTheme.promptAction.defenseAction;
    const cancelColor = this.theme.gameTheme.promptAction.cancel;
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
            attackColor,
            disabled,
            minimal,
            touch,
          ),
          this.makeActionButton(
            !minimal && attackCount > 0 ? `Attack (${attackCount})` : "Attack",
            "lucide-sword",
            action.onSubmitAttack,
            attackColor,
            disabled || attackCount === 0,
            minimal,
            touch,
            { badge: minimal && attackCount > 0 ? String(attackCount) : undefined },
          ),
          this.makeActionButton(
            "Pass",
            "lucide-ban",
            action.onPassPriority,
            passColor,
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
              defenseColor,
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
            cancelColor,
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
            color: attackColor,
            foreground: this.theme.appTheme["primary-foreground"],
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
              color: attackColor,
              foreground: this.theme.appTheme["primary-foreground"],
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
            color: attackColor,
            foreground: this.theme.appTheme["primary-foreground"],
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
            passColor,
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
              cancel ? cancelColor : passColor,
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
            color: cancelColor,
            foreground: this.theme.appTheme["primary-foreground"],
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
                passColor,
                disabled,
                true,
                touch,
              ),
              this.makeActionButton(
                "Mulligan",
                "lucide-rotate-cw",
                action.onMulliganDraw,
                this.theme.appTheme.secondary,
                disabled,
                true,
                touch,
                {
                  badge: (action.mulliganCount ?? 0) > 0 ? String(action.mulliganCount) : undefined,
                  foreground: this.theme.appTheme["secondary-foreground"],
                },
              ),
            ],
            6,
          );
        }
        const width = availableWidth;
        return this.layoutActionRow(
          [
            this.makeButton("Keep", action.onMulliganKeep, {
              color: passColor,
              foreground: this.theme.gameTheme.textOnTinted,
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
              color: this.theme.appTheme.secondary,
              foreground: this.theme.appTheme["secondary-foreground"],
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
    color: string,
    disabled: boolean,
    minimal: boolean,
    touch: boolean,
    options: { badge?: string; title?: string; foreground?: string } = {},
  ): PromptButton {
    const showLabel = minimal || touch;
    return this.makeButton(label, onPress, {
      color,
      foreground: options.foreground ?? this.theme.appTheme["primary-foreground"],
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
    const passColor = this.theme.gameTheme.promptAction.passAction;
    const foreground = this.theme.appTheme["primary-foreground"];
    const stackEmpty = this.spec!.gameView.stack.length === 0;
    const endLabel = stackEmpty ? (action.isMyTurn ? "END TURN" : "NEXT TURN") : "RESOLVE STACK";
    const endTitle = stackEmpty
      ? action.isMyTurn
        ? "Pass until end of turn"
        : "Pass until the next turn"
      : "Pass until the stack is empty";
    const endCombo = resolveCombo("pass-end-of-turn", useKeybindingsStore.getState().overrides);
    const endComboTitle = endCombo ? `${endTitle} (${comboSymbols(endCombo)})` : endTitle;
    const passCombo = resolveCombo("pass-priority", useKeybindingsStore.getState().overrides);
    const morphed = this.endTurnModifiersHeld;
    const counting = this.autopassRemainingMs != null;
    const passLabel = morphed ? endLabel : counting ? "PASSING" : "PASS";

    if (minimal) {
      const pass = this.makeButton(
        passLabel,
        morphed ? action.onPassEndTurn : action.onPassPriority,
        {
          color: passColor,
          foreground,
          flat: true,
          shadow: true,
          radius: 20,
          disabled,
          height: 40,
          paddingX: 16,
          fontSize: 12,
          fontWeight: "900",
          letterSpacing: 1.44,
          title: morphed ? endTitle : undefined,
        },
      );
      const end = this.makeButton(endLabel, action.onPassEndTurn, {
        color: this.theme.appTheme.secondary,
        foreground: this.theme.appTheme["secondary-foreground"],
        flat: true,
        radius: 20,
        disabled,
        height: 40,
        paddingX: 12,
        fontSize: 10,
        fontWeight: "900",
        letterSpacing: 1.2,
      });
      const row = this.layoutActionRow([pass, end], 4);
      if (counting) this.addAutopassFill(pass, pass.buttonWidth, pass.buttonHeight, 20, foreground);
      return row;
    }

    const container = new Container();
    const width = availableWidth;
    const height = 48;
    const buttonY = 4;
    const buttonHeight = 40;
    const outer = new Graphics()
      .roundRect(0, buttonY, width, buttonHeight, 8)
      .fill({ color: hexToNum(passColor) })
      .stroke({ color: hexToNum(foreground), width: 1, alpha: 0.2 });
    container.addChild(outer);
    if (morphed) {
      container.addChild(
        new Graphics()
          .roundRect(0, buttonY, width, buttonHeight, 8)
          .fill({ color: hexToNum(foreground), alpha: 0.15 }),
      );
    }
    const endText = promptText(endLabel, 11, foreground, {
      weight: "700",
      letterSpacing: 1.54,
    });
    const endWidth = morphed ? 0 : endText.width + 28;
    const passWidth = width - endWidth;
    if (counting && !morphed) {
      const progress = 1 - this.autopassRemainingMs! / this.autopassTotalMs;
      const fill = new Graphics()
        .rect(0, buttonY, passWidth, buttonHeight)
        .fill({ color: hexToNum(foreground), alpha: 0.25 });
      fill.scale.x = progress;
      container.addChild(fill);
      this.autopassFill = fill;
    }
    if (!morphed) {
      const endBackground = new Graphics()
        .rect(passWidth, buttonY, endWidth, buttonHeight)
        .fill({ color: 0x000000, alpha: 0.15 });
      container.addChild(endBackground);
      container.addChild(
        new Graphics()
          .rect(passWidth, buttonY, 1, buttonHeight)
          .fill({ color: hexToNum(foreground), alpha: 0.2 }),
      );
      endText.anchor.set(0.5);
      endText.position.set(passWidth + endWidth / 2, buttonY + buttonHeight / 2);
      endText.alpha = 0.75;
      container.addChild(endText);
      this.makeActionHitTarget(
        container,
        passWidth,
        buttonY,
        endWidth,
        buttonHeight,
        endComboTitle,
        disabled,
        action.onPassEndTurn,
      );
    }
    const passText = promptText(passLabel, 12, foreground, {
      weight: "900",
      letterSpacing: 1.68,
    });
    const chipCombo = morphed ? endCombo : passCombo;
    const chip = chipCombo ? this.makeKeyChip(comboSymbols(chipCombo), foreground) : null;
    const groupWidth = passText.width + (chip ? chip.width + 6 : 0);
    passText.anchor.set(0.5);
    passText.position.set(passWidth / 2 - (chip ? (chip.width + 6) / 2 : 0), buttonY + 20);
    container.addChild(passText);
    if (chip) {
      chip.position.set(passText.x + passText.width / 2 + 6, buttonY + 20);
      container.addChild(chip);
    }
    if (morphed) {
      passText.x = width / 2 - (chip ? (chip.width + 6) / 2 : 0);
    } else if (groupWidth > passWidth - 12) {
      passText.scale.set((passWidth - 12) / groupWidth);
      if (chip) chip.scale.set((passWidth - 12) / groupWidth);
    }
    this.makeActionHitTarget(
      container,
      0,
      buttonY,
      passWidth,
      buttonHeight,
      morphed ? endTitle : "Pass priority",
      disabled,
      morphed ? action.onPassEndTurn : action.onPassPriority,
    );
    container.alpha = disabled ? 0.6 : 1;
    return { container, width, height };
  }

  private buildNoActionView(availableWidth: number, minimal: boolean): ActionViewLayout {
    const container = new Container();
    const width = minimal ? 30 : availableWidth;
    const height = minimal ? 40 : 48;
    const hourglass = this.makeIcon(
      "lucide-hourglass",
      14,
      this.theme.appTheme["muted-foreground"],
    );
    hourglass.position.set(minimal ? width / 2 : width / 2 - 69, height / 2);
    container.addChild(hourglass);
    this.actionHourglass = hourglass;
    if (!minimal) {
      const label = promptText("WAITING FOR OTHERS", 11, this.theme.appTheme["muted-foreground"], {
        weight: "600",
        letterSpacing: 1.54,
      });
      label.anchor.set(0.5);
      label.position.set(width / 2 + 10, height / 2);
      container.addChild(label);
    }
    return { container, width, height };
  }

  private promptSourceCard(): CardDto | null {
    const promptSource = this.spec?.currentPrompt?.sourceCard;
    if (promptSource) return promptSource;
    const deckSource = this.spec?.sourceDeckCard;
    return deckSource ? deckCardToPreviewDto(deckSource) : null;
  }
  private promptCardDimensions(maxHeight = Number.POSITIVE_INFINITY): {
    width: number;
    height: number;
  } {
    const availableCardHeight = Math.max(112, (this.viewportHeight - CARD_VERTICAL_RESERVE) / 2);
    const width = Math.min(
      CARD_WIDTH,
      (availableCardHeight * CARD_W) / CARD_H,
      (maxHeight * CARD_W) / CARD_H,
      Math.max(80, this.viewportWidth - PANEL_PADDING * 2 - 24),
    );
    return { width, height: width * CARD_ASPECT_RATIO };
  }

  private promptCardState(card: CardDto): PromptCardDisplayState {
    let state = this.promptCardStates.get(card.id);
    if (!state) {
      state = {
        rulesView: usePreferencesStore.getState().promptCardStyle === "rules",
        face: card.isTransformed ? 1 : 0,
      };
      this.promptCardStates.set(card.id, state);
    }
    return state;
  }

  private configurePromptCardSprite(sprite: CardSprite, card: CardDto): void {
    const state = this.promptCardState(card);
    sprite.setPreviewFace(state.face);
    sprite.setHandRulesView(state.rulesView);
  }

  private bindPromptCardActivation(target: Container, card: CardDto, sprite: CardSprite): void {
    const showFeedback = () => {
      sprite.setElevation(1);
      sprite.setRing(hexToNum(this.theme.gameTheme.cardRing));
    };
    const hideFeedback = () => {
      sprite.setElevation(0);
      sprite.setRing(null);
    };
    const activate = () => {
      this.activePromptCardId = card.id;
      this.activePromptCard = { card, sprite };
      showFeedback();
    };
    const deactivate = () => {
      if (this.activePromptCard?.sprite !== sprite) return;
      this.activePromptCardId = null;
      this.activePromptCard = null;
      hideFeedback();
    };
    if (this.activePromptCardId === card.id) {
      this.activePromptCard = { card, sprite };
      showFeedback();
    }
    target.on("pointerenter", activate);
    target.on("pointerleave", deactivate);
    target.on("pointerdown", activate);
    target.on("focusin", activate);
    target.on("focusout", deactivate);
  }

  private handlePromptCardShortcut(event: KeyboardEvent): boolean {
    const active = this.activePromptCard;
    const pressed = comboFromEvent(event);
    if (!active || !pressed) return false;
    const overrides = useKeybindingsStore.getState().overrides;
    const viewCombo = resolveCombo("toggle-card-view", overrides);
    if (viewCombo && combosMatch(pressed, viewCombo)) {
      const state = this.promptCardState(active.card);
      state.rulesView = !state.rulesView;
      active.sprite.setHandRulesView(state.rulesView);
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }
    const flipCombo = resolveCombo("flip-card", overrides);
    if (!active.card.isDoubleFaced || !flipCombo || !combosMatch(pressed, flipCombo)) return false;
    const state = this.promptCardState(active.card);
    state.face = state.face === 0 ? 1 : 0;
    active.sprite.setPreviewFace(state.face);
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  private promptCardShortcutHint(): string {
    const overrides = useKeybindingsStore.getState().overrides;
    const viewCombo = resolveCombo("toggle-card-view", overrides);
    const flipCombo = resolveCombo("flip-card", overrides);
    return [
      viewCombo ? `${formatCombo(viewCombo)} changes view` : null,
      flipCombo ? `${formatCombo(flipCombo)} flips face` : null,
    ]
      .filter((entry): entry is string => entry != null)
      .join(" · ");
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
          action.targetCompletionKind === "cancel"
            ? this.theme.gameTheme.promptAction.cancel
            : this.theme.gameTheme.promptAction.passAction,
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
      .fill({ color: 0xffffff, alpha: 0.05 })
      .stroke({ color: 0xffffff, width: 1, alpha: 0.2 });
    const crosshair = this.makeIcon("lucide-crosshair", 14, "#ffffff");
    crosshair.position.set(14, 18);
    crosshair.alpha = 0.8;
    this.actionPulseNodes.push({ node: crosshair, maxAlpha: 0.8 });
    const text = promptText(label, 12, "#ffffff", {
      weight: "600",
      width: stripWidth - 38,
      truncate: true,
      letterSpacing: 0.3,
    });
    text.anchor.set(0.5);
    text.position.set(stripWidth / 2 + 6, 18);
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
        const text = promptText(description, 12, this.theme.appTheme["muted-foreground"], {
          width: availableWidth - 68,
        });
        text.position.set(68, 4);
        container.addChild(text);
        if (info.delveCount) {
          const delved = promptText(
            `Delved for {${info.delveCount}}`,
            12,
            this.theme.appTheme["muted-foreground"],
          );
          delved.position.set(68, 8 + text.height);
          container.addChild(delved);
        }
        y = 92;
        width = availableWidth;
      }
    } else if (!minimal && info) {
      const description = info.description || `Cast ${info.cardName} for ${info.manaCost}`;
      const text = promptText(description, 12, this.theme.appTheme["muted-foreground"], {
        width: availableWidth,
        align: "center",
      });
      text.anchor.set(0.5, 0);
      text.position.set(availableWidth / 2, 0);
      container.addChild(text);
      y = text.height + 8;
      width = availableWidth;
    }
    const buttons = [
      this.makeActionButton(
        info?.canConfirmFromPool ? "Confirm" : "Auto",
        info?.canConfirmFromPool ? "lucide-check" : "lucide-wand-sparkles",
        info?.canConfirmFromPool ? action.onPayManaCost : action.onAutoManaCost,
        this.theme.gameTheme.promptAction.passAction,
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
          this.theme.gameTheme.promptAction.defenseAction,
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
          this.theme.gameTheme.promptAction.attackAction,
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
        this.theme.gameTheme.promptAction.cancel,
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
    const color = this.theme.appTheme.primary;
    if (minimal) {
      const label = promptText(
        `${selected}/${count}`,
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
        color,
        !canConfirm,
        true,
        touch,
        { foreground: this.theme.appTheme["primary-foreground"] },
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
      `${selected}/${count} TO LIBRARY BOTTOM`,
      10,
      this.theme.appTheme["muted-foreground"],
      {
        weight: "600",
        letterSpacing: 0.8,
      },
    );
    label.anchor.set(0.5, 0);
    label.position.set(width / 2, 0);
    const button = this.makeButton("CONFIRM", action.onMulliganPutBackConfirm, {
      color,
      foreground: this.theme.appTheme["primary-foreground"],
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
      .fill({ color: 0x000000, alpha: 0.18 })
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
    const icon = this.makeIcon("lucide-settings", 14, this.theme.appTheme["muted-foreground"]);
    icon.position.set(size / 2, size / 2);
    button.addChild(icon);
    button.eventMode = "static";
    button.cursor = "pointer";
    const inset = minimal ? 8 : 10;
    button.hitArea = new Rectangle(-inset, -inset, size + inset * 2, size + inset * 2);
    button.on("pointerover", () => {
      icon.tint = hexToNum(this.theme.appTheme.foreground);
    });
    button.on("pointerout", () => {
      icon.tint = hexToNum(this.theme.appTheme["muted-foreground"]);
    });
    button.on("focusin", () => {
      icon.tint = hexToNum(this.theme.appTheme.foreground);
    });
    button.on("focusout", () => {
      icon.tint = hexToNum(this.theme.appTheme["muted-foreground"]);
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
        color: fullControl ? "#ffffff" : this.theme.appTheme.border,
        foreground: fullControl
          ? this.theme.appTheme.foreground
          : this.theme.appTheme["muted-foreground"],
        outline: true,
        backgroundColor: "#ffffff",
        backgroundAlpha: fullControl ? 0.15 : 0.05,
        borderColor: fullControl ? "#ffffff" : this.theme.appTheme.border,
        hoverBackgroundAlpha: fullControl ? 0.2 : 0.1,
        hoverBorderAlpha: fullControl ? 0.3 : 1,
        hoverForeground: this.theme.appTheme.foreground,
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

  private makeActionHitTarget(
    parent: Container,
    x: number,
    y: number,
    width: number,
    height: number,
    title: string,
    disabled: boolean,
    onPress: (() => void) | undefined,
  ): Container {
    const hit = new Container();
    hit.position.set(x, y);
    hit.hitArea = new Rectangle(0, 0, width, height);
    hit.eventMode = disabled ? "none" : "static";
    hit.cursor = disabled ? "default" : "pointer";
    hit.accessible = true;
    hit.accessibleTitle = title;
    hit.tabIndex = disabled ? -1 : 0;
    hit.on("pointertap", () => {
      if (!disabled) onPress?.();
    });
    parent.addChild(hit);
    return hit;
  }

  private makeKeyChip(value: string, color: string): Container {
    const container = new Container();
    const text = promptText(value, 10, color, { weight: "700" });
    const width = text.width + 12;
    container.addChild(
      new Graphics().roundRect(0, -10, width, 20, 4).fill({ color: 0x000000, alpha: 0.25 }),
      text,
    );
    text.anchor.set(0.5);
    text.alpha = 0.85;
    text.position.set(width / 2, 0);
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
    const input = this.spec?.currentPrompt?.input;
    if (
      input?.type !== "chooseAction" ||
      this.spec?.gameView.stack.length !== 0 ||
      usePromptPreferencesStore.getState().fullControl ||
      !input.actions.every((action) => action.type === "activateAbility" && action.isManaAbility)
    ) {
      return;
    }
    this.autopassTotalMs =
      AUTOPASS_DELAY_MIN_MS + Math.random() * (AUTOPASS_DELAY_MAX_MS - AUTOPASS_DELAY_MIN_MS);
    this.autopassRemainingMs = this.autopassTotalMs;
  }

  private bumpActionPanel(): void {
    const panel = this.actionPanel;
    if (!panel || !animationsEnabled()) return;
    gsap.killTweensOf(panel.scale);
    const bumpScale = 1 + 12 / Math.max(1, this.actionPanelHeight);
    gsap
      .timeline()
      .to(panel.scale, { y: bumpScale, duration: 0.112, ease: "back.out(1.56)" })
      .to(panel.scale, { y: 1, duration: 0.168, ease: "power2.out" });
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
      const blockedIds = new Set(
        action.blockAssignments.map((assignment) => assignment.attackerId),
      );
      const attackerCount = sample ? 3 : activeAttackers.length;
      const blockedCount = sample ? 1 : activeAttackers.filter((id) => blockedIds.has(id)).length;
      const unblockedCount = attackerCount - blockedCount;
      const incomingDamage = sample
        ? 7
        : activeAttackers.reduce((sum, id) => {
            if (blockedIds.has(id)) return sum;
            const card = action.resolveCard(id);
            const power = Math.max(0, parseCombatNumber(card?.power));
            const doubles =
              card?.keywords?.some((keyword) =>
                keyword.toLowerCase().startsWith("double strike"),
              ) ?? false;
            return sum + (doubles ? power * 2 : power);
          }, 0);
      const firstStrike =
        sample ||
        [
          ...activeAttackers,
          ...action.blockAssignments.map((assignment) => assignment.blockerId),
        ].some(
          (id) =>
            action.resolveCard(id)?.keywords?.some((keyword) => {
              const normalized = keyword.toLowerCase();
              return (
                normalized.startsWith("first strike") || normalized.startsWith("double strike")
              );
            }) ?? false,
        );
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
        `${showIncoming ? "Incoming" : "Open"} ${incomingDamage}`,
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
        const lethalLabel = promptText("LETHAL", 10, destructive, {
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
      if (isBlockDecl && !sample) {
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
        target.on("pointertap", () => {
          this.combatBreakdownOpen = true;
          this.rebuild();
        });
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
      const text = promptText(line, 11, this.theme.appTheme["muted-foreground"], {
        width: width - 24,
      });
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
      const mask = new Graphics().rect(0, 0, width, height).fill({ color: 0xffffff });
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

  private renderCombatBreakdown(): void {
    const action = this.spec!.action;
    const blockedIds = new Set(action.blockAssignments.map((entry) => entry.attackerId));
    const attackerPower = action.attackerIds.reduce(
      (sum, id) => sum + Math.max(0, parseCombatNumber(action.resolveCard(id)?.power)),
      0,
    );
    const blockerToughness = action.blockAssignments.reduce(
      (sum, entry) => sum + parseCombatNumber(action.resolveCard(entry.blockerId)?.toughness),
      0,
    );
    const incoming = action.attackerIds.reduce((sum, id) => {
      if (blockedIds.has(id)) return sum;
      const card = action.resolveCard(id);
      const power = Math.max(0, parseCombatNumber(card?.power));
      const doubleStrike =
        card?.keywords?.some((keyword) => keyword.toLowerCase().startsWith("double strike")) ??
        false;
      return sum + (doubleStrike ? power * 2 : power);
    }, 0);
    const width = Math.min(432, this.viewportWidth - 24);
    const rowHeight = 42;
    const height = Math.min(
      this.viewportHeight - 24,
      116 + Math.max(1, action.attackerIds.length) * rowHeight,
    );
    const x = (this.viewportWidth - width) / 2;
    const y = (this.viewportHeight - height) / 2;
    const close = () => {
      this.combatBreakdownOpen = false;
      this.rebuild();
    };
    const backdrop = new Graphics()
      .rect(0, 0, this.viewportWidth, this.viewportHeight)
      .fill({ color: hexToNum(this.theme.appTheme.overlay), alpha: 0.76 });
    backdrop.eventMode = "static";
    backdrop.hitArea = new Rectangle(0, 0, this.viewportWidth, this.viewportHeight);
    backdrop.on("pointertap", close);
    const panel = this.panel(width, height, x, y, 12);
    panel.eventMode = "static";
    panel.hitArea = new Rectangle(0, 0, width, height);
    panel.on("pointertap", (event: FederatedPointerEvent) => event.stopPropagation());
    const heading = promptText("COMBAT", 14, this.theme.appTheme.foreground, {
      weight: "700",
      letterSpacing: 0.7,
    });
    heading.position.set(18, 14);
    const closeButton = this.makeButton("", close, {
      title: "Close combat breakdown",
      icon: "lucide-x",
      iconSize: 16,
      outline: true,
      compact: true,
      width: 30,
      height: 30,
    });
    closeButton.position.set(width - 42, 8);
    const summary = promptText(
      `Power ${attackerPower}   vs   Blocker toughness ${blockerToughness}   ·   Incoming ${incoming}`,
      14,
      this.theme.appTheme.foreground,
      { weight: "600", width: width - 36, align: "center" },
    );
    summary.anchor.set(0.5, 0);
    summary.position.set(width / 2, 52);
    panel.addChild(heading, closeButton, summary);
    let rowY = 82;
    for (const attackerId of action.attackerIds) {
      const attacker = action.resolveCard(attackerId);
      const blockers = action.blockAssignments.filter((entry) => entry.attackerId === attackerId);
      panel.addChild(
        new Graphics()
          .roundRect(16, rowY, width - 32, 36, 6)
          .stroke({ color: hexToNum(this.theme.appTheme.border), width: 1, alpha: 0.5 }),
      );
      const pt =
        attacker?.power && attacker.toughness ? `${attacker.power}/${attacker.toughness}  ` : "";
      const name = promptText(
        `${pt}${action.resolveCardName(attackerId)}`,
        12,
        this.theme.appTheme.foreground,
        {
          weight: "600",
        },
      );
      name.position.set(24, rowY + 10);
      const blockerText =
        blockers.length === 0
          ? "unblocked"
          : blockers
              .map((entry) => {
                const card = action.resolveCard(entry.blockerId);
                const blockerPt =
                  card?.power && card.toughness ? `${card.power}/${card.toughness} ` : "";
                return `${blockerPt}${action.resolveCardName(entry.blockerId)}`;
              })
              .join(", ");
      const blockersLabel = promptText(
        `←  ${blockerText}`,
        11,
        blockers.length === 0
          ? this.theme.appTheme.destructive
          : this.theme.appTheme["muted-foreground"],
        { width: width / 2 - 24, truncate: true },
      );
      blockersLabel.position.set(width / 2, rowY + 10);
      panel.addChild(name, blockersLabel);
      rowY += rowHeight;
    }
    backdrop.zIndex = 50;
    panel.zIndex = 51;
    this.container.addChild(backdrop, panel);
    this.modalOpen = true;
  }

  private renderModal(): void {
    const input = this.spec!.currentPrompt!.input;
    const boardContext =
      input.type === "chooseCombatDamageAssignment" ||
      input.type === "chooseDamageAssignmentOrder" ||
      (input.type === "chooseBoolean" && input.presentation.targets.length > 0);
    const backdrop = new Graphics().rect(0, 0, this.viewportWidth, this.viewportHeight).fill({
      color: hexToNum(this.theme.appTheme.overlay),
      alpha: boardContext ? 0.38 : 0.76,
    });
    backdrop.eventMode = "static";
    backdrop.hitArea = new Rectangle(0, 0, this.viewportWidth, this.viewportHeight);
    this.container.addChild(backdrop);
    switch (input.type) {
      case "chooseBoolean":
        this.renderBoolean(input.presentation, input.denyLabel, input.confirmLabel);
        break;
      case "chooseFromSelection":
        this.renderSelection(input.presentation, input.options, input.minTotal, input.maxTotal);
        break;
      case "revealCards":
        this.renderCards(input.presentation, input.cards, 0, 0, true);
        break;
      case "chooseCards":
        this.renderCards(input.presentation, input.cards, input.min, input.max, false);
        break;
      case "chooseColor":
        this.renderColors(input.presentation, input.validColors, input.amount, input.repeatAllowed);
        break;
      case "chooseNumber":
        this.renderNumber(input.presentation, input.min, input.max);
        break;
      case "reorder":
        this.renderReorder(input.presentation, input.items);
        break;
      case "scry":
        this.renderScry(input.presentation, input.cards, input.zones);
        break;
      case "chooseCombatDamageAssignment":
        this.renderCombatDamage(input);
        break;
      case "chooseDamageAssignmentOrder":
        this.renderDamageOrder();
        break;
      case "diceRolled":
        this.renderDice(input.presentation, input.sides, input.rolls);
        break;
    }
    this.finalizeModalScroll();
  }

  private createModalShell(
    width: number,
    height: number,
    presentation: PromptPresentation,
    minimizable = true,
    boardContext = false,
  ): {
    panel: Container;
    body: Container;
    bodyTop: number;
  } {
    const sourceCard = this.promptSourceCard();
    const preferredSourceCardWidth = this.promptCardDimensions().width;
    const externalSourceCardWidth = Math.min(
      preferredSourceCardWidth,
      Math.max(0, (this.viewportWidth - width) / 2 - SOURCE_CARD_GAP - 12),
    );
    const externalSource =
      !!sourceCard && !boardContext && externalSourceCardWidth >= SOURCE_CARD_MIN_EXTERNAL_WIDTH;
    const x = (this.viewportWidth - width) / 2;
    const y = (this.viewportHeight - height) / 2;
    const panel = this.panel(width, height, x, y, 12);
    panel.eventMode = "static";
    panel.hitArea = new Rectangle(0, 0, width, height);
    panel.accessible = true;
    panel.accessibleTitle = presentation.title;
    panel.tabIndex = -1;
    const sourceSprite = sourceCard ? new CardSprite(sourceCard, "hand") : null;
    const sourceLeft = width + SOURCE_CARD_GAP;
    let sourceWidth = 0;
    if (externalSource) {
      panel.hitArea = new Rectangle(0, 0, sourceLeft + externalSourceCardWidth, height);
    }
    if (sourceSprite && sourceCard) {
      this.configurePromptCardSprite(sourceSprite, sourceCard);
      sourceSprite.setHandRulesHighlight(this.spec?.currentPrompt?.sourceAbilityText ?? "");
      sourceWidth = externalSource
        ? externalSourceCardWidth
        : Math.min(preferredSourceCardWidth, width - PANEL_PADDING * 2);
      const left = externalSource ? sourceLeft : PANEL_PADDING;
      const top = externalSource ? SOURCE_LABEL_HEIGHT : 16;
      const placeSourceSprite = () => {
        sourceSprite.scale.set(1);
        const scale = sourceWidth / sourceSprite.width;
        sourceSprite.scale.set(scale);
        sourceSprite.position.set(
          left + sourceSprite.pivot.x * scale,
          top + sourceSprite.pivot.y * scale,
        );
      };
      sourceSprite.onReorient = placeSourceSprite;
      placeSourceSprite();
      sourceSprite.cursor = "pointer";
      sourceSprite.accessible = true;
      sourceSprite.accessibleTitle = `${sourceCard.identity.name}, source card`;
      sourceSprite.accessibleHint = "Focus or hover, then change view or flip face";
      sourceSprite.tabIndex = 0;
      this.bindPromptCardActivation(sourceSprite, sourceCard, sourceSprite);
      panel.addChild(sourceSprite);
      if (externalSource) {
        const label = promptText("SOURCE", 10, this.theme.appTheme["muted-foreground"], {
          weight: "700",
        });
        label.position.set(sourceLeft, 0);
        panel.addChild(label);
      }
    }
    const titleX =
      sourceSprite && !externalSource ? PANEL_PADDING + sourceWidth + 16 : PANEL_PADDING;
    const title = promptText(
      presentation.title,
      this.viewportWidth < 760 ? 18 : 22,
      this.theme.appTheme.foreground,
      {
        weight: "700",
        width: width - titleX - 50,
      },
    );
    title.position.set(titleX, 16);
    panel.addChild(title);
    let bodyTop = 16 + title.height + 8;
    if (sourceSprite && !externalSource) bodyTop = Math.max(bodyTop, 16 + sourceSprite.height + 8);
    if (presentation.description) {
      const description = promptText(presentation.description, 14, this.theme.appTheme.foreground, {
        width: width - PANEL_PADDING * 2,
      });
      description.alpha = 0.9;
      description.position.set(PANEL_PADDING, bodyTop);
      panel.addChild(description);
      bodyTop += description.height + 6;
    }
    if (presentation.text) {
      const rules = promptText(presentation.text, 12, this.theme.appTheme["muted-foreground"], {
        width: width - PANEL_PADDING * 2,
      });
      rules.position.set(PANEL_PADDING, bodyTop);
      panel.addChild(rules);
      bodyTop += rules.height + 8;
    }
    if (minimizable) {
      const minimize = this.makeButton("", this.spec!.onHideModal, {
        title: "Minimize prompt",
        icon: "lucide-minus",
        outline: true,
        compact: true,
        width: 32,
      });
      minimize.position.set(width - 18, -14);
      panel.addChild(minimize);
    }
    const mask = new Graphics()
      .rect(PANEL_PADDING, bodyTop, width - PANEL_PADDING * 2, height - bodyTop - 8)
      .fill({ color: hexToNum(this.theme.appTheme.foreground) });
    panel.addChild(mask);
    const body = new Container();
    body.position.set(PANEL_PADDING, bodyTop);
    body.mask = mask;
    panel.addChild(body);
    panel.on("wheel", (event: FederatedWheelEvent) => {
      if (this.modalScrollMax <= 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.modalScrollOffset = Math.max(
        0,
        Math.min(this.modalScrollMax, this.modalScrollOffset + Math.sign(event.deltaY) * 48),
      );
      body.y = bodyTop - this.modalScrollOffset;
    });
    this.modalBody = { body, bodyTop, height };
    this.container.addChild(panel);
    return { panel, body, bodyTop };
  }

  private finalizeModalScroll(): void {
    const state = this.modalBody;
    if (!state) return;
    const bounds = state.body.getLocalBounds();
    const viewportHeight = state.height - state.bodyTop - 8;
    this.modalScrollMax = Math.max(0, bounds.y + bounds.height - viewportHeight);
    this.modalScrollOffset = Math.min(this.modalScrollOffset, this.modalScrollMax);
    state.body.y = state.bodyTop - this.modalScrollOffset;
  }

  private renderBoolean(
    presentation: PromptPresentation,
    denyLabel: string,
    confirmLabel: string,
  ): void {
    const width = Math.min(520, this.viewportWidth - 24);
    const height = Math.min(280, this.viewportHeight - 24);
    const { body } = this.createModalShell(
      width,
      height,
      presentation,
      true,
      presentation.targets.length > 0,
    );
    const buttons = [
      this.makeButton(denyLabel, () => this.spec!.respond({ type: "decision", value: false }), {
        outline: true,
        width: 150,
        height: 58,
      }),
      this.makeButton(confirmLabel, () => this.spec!.respond({ type: "decision", value: true }), {
        width: 150,
        height: 58,
      }),
    ];
    this.addButtonRow(body, buttons, Math.max(12, height - body.y - 76), width - PANEL_PADDING * 2);
  }

  private renderSelection(
    presentation: PromptPresentation,
    options: SelectionOption[],
    minTotal: number,
    maxTotal: number,
  ): void {
    const showFilter = options.length > 5;
    const indexedOptions = options.map((option, index) => ({ option, index }));
    const visibleOptions = showFilter
      ? indexedOptions.filter(({ option }) =>
          option.label.toLocaleLowerCase().includes(this.selectionFilter.toLocaleLowerCase()),
        )
      : indexedOptions;
    const width = Math.min(560, this.viewportWidth - 24);
    const height = Math.min(Math.max(300, 170 + options.length * 48), this.viewportHeight - 24);
    const { body } = this.createModalShell(width, height, presentation);
    const autoConfirm = minTotal === 1 && maxTotal === 1;
    const availableWidth = width - PANEL_PADDING * 2;
    const total = this.selectionTotal(options);
    let y = 4;
    if (!autoConfirm) {
      const requirement =
        minTotal === maxTotal
          ? `${total}/${maxTotal} selected`
          : `${total} selected · choose ${minTotal}–${maxTotal}`;
      const status = promptText(requirement, 12, this.theme.appTheme.primary, {
        weight: "700",
      });
      status.position.set(2, y);
      body.addChild(status);
      y += 28;
    }
    if (showFilter) {
      const filterBg = new Graphics()
        .roundRect(0, y, availableWidth, 32, 8)
        .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.55 })
        .stroke({ color: hexToNum(this.theme.appTheme.border), width: 1, alpha: 0.8 });
      const filter = promptText(
        `⌕  ${this.selectionFilter || "Type to filter choices"}`,
        12,
        this.selectionFilter
          ? this.theme.appTheme.foreground
          : this.theme.appTheme["muted-foreground"],
        { width: availableWidth - 18 },
      );
      filter.position.set(10, y + 8);
      body.addChild(filterBg, filter);
      y += 42;
    }
    if (visibleOptions.length === 0) {
      const empty = promptText("No choices match this filter", 12, this.theme.appTheme.muted, {
        width: availableWidth,
        align: "center",
      });
      empty.position.set(0, y + 18);
      body.addChild(empty);
      y += 58;
    }
    for (const { option, index } of visibleOptions) {
      const count = this.counts.get(index) ?? 0;
      const currentTotal = this.selectionTotal(options);
      const selected = count > 0;
      const disabled =
        option.weight > maxTotal || (!selected && currentTotal + option.weight > maxTotal);
      const repeatedWidth = option.canRepeat ? availableWidth - 76 : availableWidth;
      const weightLabel = option.weight > 1 ? ` · ${option.weight} points` : "";
      const label = option.canRepeat
        ? `${option.label}${weightLabel}  × ${count}`
        : `${option.label}${weightLabel}`;
      const increment = () => {
        if (autoConfirm) {
          this.spec!.respond({ type: "selectionDecision", chosenIndices: [index] });
          return;
        }
        if (option.canRepeat) {
          this.counts.set(index, count + 1);
        } else if (selected) {
          this.counts.delete(index);
        } else {
          if (maxTotal === 1) this.counts.clear();
          this.counts.set(index, 1);
        }
        this.rebuild();
      };
      const button = this.makeButton(label, increment, {
        outline: !selected,
        disabled,
        width: repeatedWidth,
        icon: !option.canRepeat && selected && !autoConfirm ? "lucide-check" : undefined,
      });
      button.position.set(0, y);
      body.addChild(button);
      if (option.canRepeat) {
        const minus = this.makeButton(
          "",
          () => {
            if (count <= 1) this.counts.delete(index);
            else this.counts.set(index, count - 1);
            this.rebuild();
          },
          {
            title: "Remove one",
            icon: "lucide-minus",
            outline: true,
            compact: true,
            disabled: count === 0,
            width: 32,
          },
        );
        minus.position.set(availableWidth - 72, y + 3);
        body.addChild(minus);
        const plus = this.makeButton("", increment, {
          title: "Add one",
          icon: "lucide-plus",
          outline: true,
          compact: true,
          disabled,
          width: 32,
        });
        plus.position.set(availableWidth - 34, y + 3);
        body.addChild(plus);
      }
      y += 44;
    }
    if (!autoConfirm) {
      const selectedTotal = this.selectionTotal(options);
      const canConfirm = selectedTotal >= minTotal && selectedTotal <= maxTotal;
      const label =
        minTotal === 0 && selectedTotal === 0
          ? "SKIP"
          : `CONFIRM${selectedTotal ? ` (${selectedTotal})` : ""}`;
      const confirm = this.makeButton(
        label,
        () => {
          const chosenIndices = [...this.counts.entries()]
            .sort(([left], [right]) => Number(left) - Number(right))
            .flatMap(([index, count]) => Array.from({ length: count }, () => Number(index)));
          this.spec!.respond({ type: "selectionDecision", chosenIndices });
        },
        { disabled: !canConfirm, width: 130 },
      );
      confirm.position.set(availableWidth - confirm.buttonWidth, y + 8);
      body.addChild(confirm);
    }
  }

  private selectionTotal(options: SelectionOption[]): number {
    let total = 0;
    for (const [index, count] of this.counts) {
      if (typeof index === "number") total += count * (options[index]?.weight ?? 0);
    }
    return total;
  }

  private renderCards(
    presentation: PromptPresentation,
    cards: CardDto[],
    min: number,
    max: number,
    reveal: boolean,
  ): void {
    const width = Math.min(CARD_MODAL_MAX_WIDTH, this.viewportWidth - 24);
    const cardAreaWidth = width - PANEL_PADDING * 2 - CARD_TILE_EDGE_INSET * 2;
    const { width: preferredCardWidth } = this.promptCardDimensions();
    const cardWidth = Math.min(preferredCardWidth, cardAreaWidth);
    const cardHeight = cardWidth * CARD_ASPECT_RATIO;
    const columns = Math.max(
      1,
      Math.min(cards.length, Math.floor((cardAreaWidth + 10) / (cardWidth + 10))),
    );
    const rows = Math.ceil(cards.length / columns);
    const height = Math.min(this.viewportHeight - 24, 244 + rows * (cardHeight + 12));
    const { body } = this.createModalShell(
      width,
      height,
      reveal
        ? {
            ...presentation,
            title: "Cards Revealed",
            description: `${cards.length} card${cards.length === 1 ? "" : "s"} shown`,
          }
        : presentation,
    );
    const summary = reveal
      ? "Review the cards before continuing"
      : `${this.selectedIds.size}/${max} selected`;
    const shortcuts = this.promptCardShortcutHint();
    const status = promptText(
      `${summary}${shortcuts ? ` · ${shortcuts}` : ""}`,
      12,
      reveal ? this.theme.appTheme["muted-foreground"] : this.theme.appTheme.primary,
      { weight: reveal ? "500" : "700" },
    );
    status.position.set(0, 3);
    body.addChild(status);
    const startY = 32;
    cards.forEach((card, index) => {
      const selected = this.selectedIds.has(card.id);
      const disabled = !reveal && this.selectedIds.size >= max && !selected;
      const tile = this.createCardTile(card, selected, disabled, cardWidth, cardHeight, () => {
        if (reveal || disabled) return;
        if (selected) this.selectedIds.delete(card.id);
        else this.selectedIds.add(card.id);
        this.rebuild();
      });
      const row = Math.floor(index / columns);
      const column = index % columns;
      tile.position.set(
        CARD_TILE_EDGE_INSET + column * (cardWidth + 10),
        startY + row * (cardHeight + 12),
      );
      body.addChild(tile);
    });
    const footerY = startY + rows * (cardHeight + 12) + 6;
    const chosen = [...this.selectedIds];
    const canConfirm = reveal || (chosen.length >= min && chosen.length <= max);
    const label = reveal
      ? "CONTINUE"
      : chosen.length === 0 && min === 0
        ? "SKIP"
        : `CONFIRM ${chosen.length}/${max}`;
    const confirm = this.makeButton(
      label,
      () => {
        if (reveal) this.spec!.respond({ type: "revealCardsAcknowledged" });
        else this.spec!.respond({ type: "chooseCardsDecision", chosenCardIds: chosen });
      },
      { disabled: !canConfirm, width: 148 },
    );
    confirm.position.set(width - PANEL_PADDING * 2 - confirm.buttonWidth, footerY);
    body.addChild(confirm);
  }

  private createCardTile(
    card: CardDto,
    selected: boolean,
    disabled: boolean,
    width: number,
    height: number,
    onPress?: () => void,
  ): Container {
    const tile = new Container();
    tile.eventMode = "static";
    tile.cursor = disabled ? "default" : onPress ? "pointer" : "default";
    tile.hitArea = new Rectangle(0, 0, width, height);
    tile.accessible = true;
    tile.accessibleTitle = `${card.identity.name}${selected ? ", selected" : ""}${
      disabled ? ", unavailable" : ""
    }`;
    tile.accessibleHint = disabled
      ? "This card is not currently movable"
      : "Focus or hover, then change view or flip face";
    tile.tabIndex = 0;
    const sprite = new CardSprite(card, "hand");
    this.configurePromptCardSprite(sprite, card);
    const placeSprite = () => {
      sprite.scale.set(1);
      const scale = Math.min(width / sprite.width, height / sprite.height);
      sprite.scale.set(scale);
      sprite.position.set(sprite.pivot.x * scale, sprite.pivot.y * scale);
    };
    sprite.onReorient = placeSprite;
    placeSprite();
    sprite.eventMode = "none";
    tile.addChild(sprite);
    this.bindPromptCardActivation(tile, card, sprite);
    if (selected) {
      const ring = new Graphics()
        .roundRect(0, 0, width, height, 6)
        .stroke({ color: hexToNum(this.theme.appTheme.primary), width: 3 });
      ring.eventMode = "none";
      tile.addChild(ring);
    }
    tile.alpha = disabled ? 0.42 : 1;
    tile.on("pointertap", () => {
      if (disabled) return;
      onPress?.();
    });
    return tile;
  }

  private renderColors(
    presentation: PromptPresentation,
    validColors: string[],
    amount: number,
    repeatAllowed: boolean,
  ): void {
    const width = Math.min(620, this.viewportWidth - 24);
    const height = Math.min(
      this.viewportHeight - 24,
      amount <= 1 ? 230 : 180 + validColors.length * 58,
    );
    const { body } = this.createModalShell(width, height, presentation);
    const colors: Record<string, string> = {
      White: this.theme.gameTheme.mana.W,
      Blue: this.theme.gameTheme.mana.U,
      Black: this.theme.gameTheme.mana.B,
      Red: this.theme.gameTheme.mana.R,
      Green: this.theme.gameTheme.mana.G,
      Colorless: this.theme.gameTheme.mana.C,
      W: this.theme.gameTheme.mana.W,
      U: this.theme.gameTheme.mana.U,
      B: this.theme.gameTheme.mana.B,
      R: this.theme.gameTheme.mana.R,
      G: this.theme.gameTheme.mana.G,
      C: this.theme.gameTheme.mana.C,
    };
    if (amount <= 1) {
      const buttons = validColors.map((color) =>
        this.makeButton(
          color,
          () => this.spec!.respond({ type: "colorDecision", chosenColors: { [color]: 1 } }),
          {
            color: colors[color] ?? this.theme.appTheme.muted,
            foreground: this.theme.gameTheme.textOnTinted,
            width: 112,
            height: 64,
            iconTexture: loadManaSymbolTexture(this.manaSymbol(color)),
            iconTint: false,
            iconSize: 28,
          },
        ),
      );
      this.addButtonRow(body, buttons, 18, width - PANEL_PADDING * 2);
      return;
    }
    let y = 4;
    const total = [...this.counts.values()].reduce((sum, value) => sum + value, 0);
    for (const color of validColors) {
      const count = this.counts.get(color) ?? 0;
      const manaIcon = this.makeManaIcon(this.manaSymbol(color), 28);
      manaIcon.position.set(14, y + 18);
      const colorText = promptText(color, 13, this.theme.appTheme.foreground, { weight: "600" });
      colorText.position.set(38, y + 9);
      body.addChild(manaIcon, colorText);
      const minus = this.makeButton(
        "",
        () => {
          if (count <= 1) this.counts.delete(color);
          else this.counts.set(color, count - 1);
          this.rebuild();
        },
        {
          title: "Remove one",
          icon: "lucide-minus",
          color: colors[color],
          outline: true,
          disabled: count <= 0,
          compact: true,
          width: 34,
        },
      );
      const countText = promptText(String(count), 14, this.theme.appTheme.foreground, {
        weight: "700",
      });
      const plus = this.makeButton(
        "",
        () => {
          this.counts.set(color, count + 1);
          this.rebuild();
        },
        {
          title: "Add one",
          icon: "lucide-plus",
          color: colors[color],
          outline: true,
          disabled: total >= amount || (!repeatAllowed && count >= 1),
          compact: true,
          width: 34,
        },
      );
      minus.position.set(width - PANEL_PADDING * 2 - 104, y);
      countText.position.set(width - PANEL_PADDING * 2 - 58, y + 9);
      plus.position.set(width - PANEL_PADDING * 2 - 34, y);
      body.addChild(minus, countText, plus);
      y += 42;
    }
    const ready = total === amount;
    let previewX = 14;
    for (const [color, count] of this.counts) {
      if (typeof color !== "string") continue;
      for (let index = 0; index < count; index += 1) {
        const icon = this.makeManaIcon(this.manaSymbol(color), 26);
        icon.position.set(previewX, y + 18);
        body.addChild(icon);
        previewX += 30;
      }
    }
    const status = promptText(
      ready ? "Ready" : `${amount - total} left`,
      12,
      ready ? this.theme.gameTheme.success : this.theme.appTheme["muted-foreground"],
      { weight: "600" },
    );
    status.position.set(total > 0 ? previewX + 2 : 0, y + 10);
    body.addChild(status);
    const confirm = this.makeButton(
      "CONFIRM",
      () => {
        const chosenColors: Record<string, number> = {};
        for (const [color, count] of this.counts) {
          if (typeof color === "string" && count > 0) chosenColors[color] = count;
        }
        this.spec!.respond({ type: "colorDecision", chosenColors });
      },
      { disabled: !ready, width: 120 },
    );
    confirm.position.set(width - PANEL_PADDING * 2 - confirm.buttonWidth, y);
    body.addChild(confirm);
  }

  private renderNumber(presentation: PromptPresentation, min: number, max: number): void {
    const range = max - min + 1;
    const width = Math.min(520, this.viewportWidth - 24);
    const height = Math.min(300, this.viewportHeight - 24);
    const { body } = this.createModalShell(width, height, presentation);
    if (range <= 10) {
      const buttons = Array.from({ length: range }, (_, index) => {
        const value = min + index;
        return this.makeButton(
          String(value),
          () => this.spec!.respond({ type: "numberDecision", chosenNumber: value }),
          {
            outline: true,
            compact: true,
            width: 48,
            height: 52,
          },
        );
      });
      this.addButtonRow(body, buttons, 20, width - PANEL_PADDING * 2);
      return;
    }
    const parsedValue = Number(this.numberBuffer);
    const isValid =
      this.numberBuffer !== "" &&
      this.numberBuffer !== "-" &&
      Number.isInteger(parsedValue) &&
      parsedValue >= min &&
      parsedValue <= max;
    const valueText = promptText(this.numberBuffer || "—", 34, this.theme.appTheme.foreground, {
      weight: "700",
    });
    valueText.anchor.set(0.5);
    valueText.position.set((width - PANEL_PADDING * 2) / 2, 42);
    body.addChild(valueText);
    const setValue = (value: number) => {
      this.numberValue = Math.max(min, Math.min(max, value));
      this.numberBuffer = String(this.numberValue);
      this.rebuild();
    };
    const buttons = [
      this.makeButton("MIN", () => setValue(min), {
        title: `Set to minimum ${min}`,
        outline: true,
        width: 62,
        height: 52,
      }),
      this.makeButton("", () => setValue((isValid ? parsedValue : min) - 1), {
        title: "Decrease",
        icon: "lucide-minus",
        iconSize: 22,
        outline: true,
        disabled: isValid && parsedValue <= min,
        width: 58,
        height: 52,
      }),
      this.makeButton(
        "",
        () => this.spec!.respond({ type: "numberDecision", chosenNumber: parsedValue }),
        {
          title: "Confirm",
          icon: "lucide-check",
          iconSize: 24,
          disabled: !isValid,
          width: 70,
          height: 52,
        },
      ),
      this.makeButton("", () => setValue((isValid ? parsedValue : min) + 1), {
        title: "Increase",
        icon: "lucide-plus",
        iconSize: 22,
        outline: true,
        disabled: isValid && parsedValue >= max,
        width: 58,
        height: 52,
      }),
      this.makeButton("MAX", () => setValue(max), {
        title: `Set to maximum ${max}`,
        outline: true,
        width: 62,
        height: 52,
      }),
    ];
    this.addButtonRow(body, buttons, 82, width - PANEL_PADDING * 2);
    const rangeText = promptText(
      `Type a value or use the stepper · ${min} to ${max}`,
      12,
      this.theme.appTheme["muted-foreground"],
      { align: "center" },
    );
    rangeText.anchor.set(0.5, 0);
    rangeText.position.set((width - PANEL_PADDING * 2) / 2, 142);
    body.addChild(rangeText);
  }

  private renderReorder(presentation: PromptPresentation, items: ReorderItem[]): void {
    const width = Math.min(CARD_MODAL_MAX_WIDTH, this.viewportWidth - 24);
    const contentWidth = width - PANEL_PADDING * 2;
    const zoneWidth = contentWidth - CARD_TILE_EDGE_INSET * 2;
    const { width: preferredCardWidth } = this.promptCardDimensions();
    const cardWidth = Math.min(preferredCardWidth, zoneWidth - REORDER_CARD_INSET * 2);
    const cardHeight = cardWidth * CARD_ASPECT_RATIO;
    const hasSourceCard = !!(this.spec?.currentPrompt?.sourceCard ?? this.spec?.sourceDeckCard);
    const sourceIsInternal =
      hasSourceCard && this.viewportWidth < width + SOURCE_CARD_GAP + preferredCardWidth + 24;
    const height = Math.min(
      this.viewportHeight - 24,
      cardHeight +
        REORDER_MODAL_VERTICAL_RESERVE +
        (sourceIsInternal ? preferredCardWidth * CARD_ASPECT_RATIO : 0),
    );
    const { body } = this.createModalShell(width, height, presentation);
    const byId = new Map(items.map((item) => [item.id, item]));
    const shortcuts = this.promptCardShortcutHint();
    const instruction = promptText(
      `Drag to reorder · Leftmost resolves first${shortcuts ? ` · ${shortcuts}` : ""}`,
      12,
      this.theme.gameTheme.promptAction.defenseAction,
      { weight: "600" },
    );
    instruction.position.set(CARD_TILE_EDGE_INSET, 2);
    body.addChild(instruction);
    body.sortableChildren = true;

    const orderLabel = promptText("RESOLUTION ORDER", 11, this.theme.appTheme["muted-foreground"], {
      weight: "700",
    });
    orderLabel.position.set(CARD_TILE_EDGE_INSET, 26);
    body.addChild(orderLabel);
    const orderZone = new Rectangle(
      CARD_TILE_EDGE_INSET,
      46,
      zoneWidth,
      cardHeight + REORDER_CARD_INSET + 40,
    );
    const footerY = orderZone.y + orderZone.height + 12;
    const orderBackground = new Graphics()
      .roundRect(orderZone.x, orderZone.y, orderZone.width, orderZone.height, 8)
      .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.45 })
      .stroke({ color: hexToNum(this.theme.appTheme["muted-foreground"]), width: 2, alpha: 0.45 });
    body.addChild(orderBackground);
    this.dropZones.push({
      id: REORDER_ORDER_ZONE_ID,
      rect: orderZone,
      container: body,
      visual: orderBackground,
      dropX: orderZone.x + REORDER_CARD_INSET,
      dropY: orderZone.y + REORDER_CARD_INSET,
      targetAlpha: 1,
    });

    this.order.forEach((id, index) => {
      const item = byId.get(id);
      if (!item) return;
      const tile = this.createCardTile(item.card, false, false, cardWidth, cardHeight);
      tile.accessibleTitle = `${item.card.identity.name}, position ${index + 1}`;
      tile.accessibleHint = "Drag to reorder or use the earlier and later controls";
      tile.zIndex = index + 1;
      const x = this.reorderCardX(orderZone, cardWidth, index, this.order.length);
      const y = orderZone.y + REORDER_CARD_INSET;
      tile.position.set(x, y);
      this.makeDraggable(
        tile,
        (dropX, dropY) => this.dropReorderCard(id, cardWidth, dropX, dropY),
        (dropX, dropY) => this.reorderDropPosition(id, cardWidth, dropX, dropY),
        (dragX, dragY) => this.previewReorderGap(id, cardWidth, dragX, dragY),
      );
      const rank = new Graphics()
        .circle(0, 0, 13)
        .fill(hexToNum(index === 0 ? this.theme.appTheme.primary : this.theme.appTheme.muted));
      const rankText = promptText(
        String(index + 1),
        11,
        index === 0 ? this.theme.appTheme["primary-foreground"] : this.theme.appTheme.foreground,
        { weight: "700" },
      );
      rankText.anchor.set(0.5);
      tile.addChild(rank, rankText);

      const move = (offset: number) => {
        const target = Math.max(0, Math.min(this.order.length - 1, index + offset));
        if (target === index) return;
        this.captureReorderCardPositions();
        this.reorderSettledCardId = id;
        const next = [...this.order];
        next.splice(index, 1);
        next.splice(target, 0, id);
        this.order = next;
        this.rebuild();
      };
      const previous = this.makeButton("", () => move(-1), {
        title: "Move earlier",
        icon: "lucide-chevron-left",
        outline: true,
        compact: true,
        disabled: index === 0,
        width: 32,
        foreground: this.theme.appTheme["muted-foreground"],
        backgroundColor: this.theme.gameTheme.cardRing,
        backgroundAlpha: 0.08,
        borderColor: this.theme.gameTheme.cardRing,
        borderAlpha: 0.42,
        hoverBackgroundAlpha: 0.24,
        hoverBorderAlpha: 1,
        hoverForeground: this.theme.gameTheme.cardRing,
      });
      const next = this.makeButton("", () => move(1), {
        title: "Move later",
        icon: "lucide-chevron-right",
        outline: true,
        compact: true,
        disabled: index === this.order.length - 1,
        width: 32,
        foreground: this.theme.appTheme["muted-foreground"],
        backgroundColor: this.theme.gameTheme.cardRing,
        backgroundAlpha: 0.08,
        borderColor: this.theme.gameTheme.cardRing,
        borderAlpha: 0.42,
        hoverBackgroundAlpha: 0.24,
        hoverBorderAlpha: 1,
        hoverForeground: this.theme.gameTheme.cardRing,
      });
      const controlScale = 0.76;
      const controlGap = 10;
      const controlRowWidth = (previous.buttonWidth + next.buttonWidth) * controlScale + controlGap;
      const controlX = x + (cardWidth - controlRowWidth) / 2;
      const controlY = y + cardHeight + 8;
      const controls = new Container();
      controls.position.set(controlX, controlY);
      controls.zIndex = 100 + index;
      [previous, next].forEach((control, controlIndex) => {
        control.scale.set(controlScale);
        control.position.set(controlIndex * (control.buttonWidth * controlScale + controlGap), 0);
        controls.addChild(control);
      });
      body.addChild(tile, controls);
      this.reorderCardVisuals.set(id, {
        tile,
        controls,
        controlsOffsetX: controlX - x,
        controlsOffsetY: controlY - y,
      });

      const oldPosition = this.reorderPreviousPositions.get(id);
      if (oldPosition && animationsEnabled()) {
        const start = body.toLocal(oldPosition);
        if (Math.hypot(x - start.x, y - start.y) >= 0.5) {
          const offsetX = start.x - x;
          const offsetY = start.y - y;
          tile.position.copyFrom(start);
          controls.position.set(controlX + offsetX, controlY + offsetY);
          gsap.to(tile.position, {
            x,
            y,
            duration: REORDER_LAYOUT_SETTLE_SECONDS,
            ease: "power3.out",
          });
          gsap.to(controls.position, {
            x: controlX,
            y: controlY,
            duration: REORDER_LAYOUT_SETTLE_SECONDS,
            ease: "power3.out",
          });
        }
      }

      if (this.reorderSettledCardId === id && animationsEnabled()) {
        tile.origin.set(cardWidth / 2, cardHeight / 2);
        gsap.fromTo(
          tile.scale,
          { x: 0.97, y: 0.97 },
          {
            x: 1,
            y: 1,
            duration: REORDER_SNAP_PULSE_SECONDS,
            ease: "back.out(2.2)",
          },
        );
        const snapRing = new Graphics()
          .roundRect(0, 0, cardWidth, cardHeight, 6)
          .stroke({ color: hexToNum(this.theme.gameTheme.cardRing), width: 4 });
        snapRing.eventMode = "none";
        tile.addChild(snapRing);
        gsap.to(snapRing, {
          alpha: 0,
          duration: REORDER_SNAP_PULSE_SECONDS,
          ease: "power2.out",
        });
      }
    });
    this.reorderPreviousPositions.clear();
    this.reorderSettledCardId = null;

    const confirm = this.makeButton(
      "CONFIRM ORDER",
      () => this.spec!.respond({ type: "reorderDecision", orderedIds: [...this.order] }),
      { width: 150 },
    );
    confirm.position.set(contentWidth - confirm.buttonWidth, footerY);
    body.addChild(confirm);
  }

  private reorderCardX(zone: Rectangle, cardWidth: number, index: number, count: number): number {
    if (count <= 1) return zone.x + REORDER_CARD_INSET;
    const available = Math.max(0, zone.width - cardWidth - REORDER_CARD_INSET * 2);
    const spacing = Math.min(cardWidth + 12, available / (count - 1));
    return zone.x + REORDER_CARD_INSET + index * spacing;
  }

  private reorderInsertIndex(zone: Rectangle, cardWidth: number, count: number, x: number): number {
    if (count === 0) return 0;
    const available = Math.max(0, zone.width - cardWidth - REORDER_CARD_INSET * 2);
    const spacing = Math.min(cardWidth + 12, available / count);
    if (spacing === 0) return count;
    const firstCenter = zone.x + REORDER_CARD_INSET + cardWidth / 2;
    return Math.max(0, Math.min(count, Math.round((x - firstCenter) / spacing)));
  }

  private previewReorderGap(cardId: string, cardWidth: number, x: number, y: number): void {
    const orderZone = this.dropZones.find((zone) => zone.id === REORDER_ORDER_ZONE_ID);
    const target = this.findDropZone(x, y);
    if (!orderZone) return;

    let index: number | null = null;
    if (target?.id === REORDER_ORDER_ZONE_ID) {
      const point = target.container.toLocal({ x, y });
      index = this.reorderInsertIndex(target.rect, cardWidth, this.order.length - 1, point.x);
    }
    if (this.reorderPreview?.cardId === cardId && this.reorderPreview.index === index) return;
    this.reorderPreview = { cardId, index };

    const previewOrder = this.order.filter((id) => id !== cardId);
    if (index != null) previewOrder.splice(index, 0, cardId);
    else previewOrder.splice(this.order.indexOf(cardId), 0, cardId);

    for (const [previewIndex, id] of previewOrder.entries()) {
      const visual = this.reorderCardVisuals.get(id);
      if (!visual) continue;
      if (id === cardId) {
        gsap.killTweensOf(visual.controls);
        if (animationsEnabled()) {
          gsap.to(visual.controls, {
            alpha: 0,
            duration: REORDER_PREVIEW_SECONDS,
            ease: "power2.out",
            overwrite: true,
          });
        } else {
          visual.controls.alpha = 0;
        }
        continue;
      }

      const targetX = this.reorderCardX(
        orderZone.rect,
        cardWidth,
        previewIndex,
        previewOrder.length,
      );
      const targetY = orderZone.rect.y + REORDER_CARD_INSET;
      const controlsX = targetX + visual.controlsOffsetX;
      const controlsY = targetY + visual.controlsOffsetY;
      if (!animationsEnabled()) {
        visual.tile.position.set(targetX, targetY);
        visual.controls.position.set(controlsX, controlsY);
        continue;
      }
      gsap.to(visual.tile.position, {
        x: targetX,
        y: targetY,
        duration: REORDER_PREVIEW_SECONDS,
        ease: "power2.out",
        overwrite: true,
      });
      gsap.to(visual.controls.position, {
        x: controlsX,
        y: controlsY,
        duration: REORDER_PREVIEW_SECONDS,
        ease: "power2.out",
        overwrite: true,
      });
    }
  }

  private dropReorderCard(cardId: string, cardWidth: number, x: number, y: number): void {
    const target = this.findDropZone(x, y);
    if (!target || target.id !== REORDER_ORDER_ZONE_ID) {
      this.rebuild();
      return;
    }
    this.captureReorderCardPositions();
    this.reorderSettledCardId = cardId;
    const next = this.order.filter((id) => id !== cardId);
    const point = target.container.toLocal({ x, y });
    const index = this.reorderInsertIndex(target.rect, cardWidth, next.length, point.x);
    next.splice(index, 0, cardId);
    this.order = next;
    this.rebuild();
  }

  private reorderDropPosition(
    cardId: string,
    cardWidth: number,
    x: number,
    y: number,
  ): { x: number; y: number } | null {
    const target = this.findDropZone(x, y);
    if (!target || target.id !== REORDER_ORDER_ZONE_ID) return null;
    const nextOrder = this.order.filter((id) => id !== cardId);
    const point = target.container.toLocal({ x, y });
    const index = this.reorderInsertIndex(target.rect, cardWidth, nextOrder.length, point.x);
    return {
      x: this.reorderCardX(target.rect, cardWidth, index, nextOrder.length + 1),
      y: target.rect.y + REORDER_CARD_INSET,
    };
  }

  private captureReorderCardPositions(): void {
    this.reorderPreviousPositions.clear();
    for (const [cardId, visual] of this.reorderCardVisuals) {
      const position = visual.tile.toGlobal({ x: 0, y: 0 });
      this.reorderPreviousPositions.set(cardId, { x: position.x, y: position.y });
    }
  }

  private clearReorderCardVisuals(): void {
    for (const { tile, controls } of this.reorderCardVisuals.values()) {
      gsap.killTweensOf(tile.position);
      gsap.killTweensOf(tile.scale);
      gsap.killTweensOf(controls.position);
      gsap.killTweensOf(controls);
    }
    this.reorderCardVisuals.clear();
    this.reorderPreview = null;
  }

  private renderScry(
    presentation: PromptPresentation,
    cards: CardDto[],
    zones: ScryDestination[],
  ): void {
    const width = Math.min(CARD_MODAL_MAX_WIDTH, this.viewportWidth - 24);
    const height = this.viewportHeight - 24;
    const { body, bodyTop } = this.createModalShell(width, height, presentation);
    const bodyHeight = height - bodyTop - 8;
    const maxCardHeight = Math.max(112, (bodyHeight - SCRY_BODY_VERTICAL_RESERVE) / 2);
    const { width: cardWidth, height: cardHeight } = this.promptCardDimensions(maxCardHeight);
    body.sortableChildren = true;
    const byId = new Map(cards.map((card) => [card.id, card]));
    const poolHeight = cardHeight + 28;
    const poolWidth = width - PANEL_PADDING * 2;
    const pool = new Rectangle(0, 24, poolWidth, poolHeight);
    const poolBg = new Graphics()
      .roundRect(pool.x, pool.y, pool.width, pool.height, 8)
      .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.6 })
      .stroke({ color: hexToNum(this.theme.appTheme["muted-foreground"]), width: 2, alpha: 0.45 });
    body.addChild(poolBg);
    const poolIds = this.scryItems.pool ?? [];
    const poolDropCount = poolIds.length + 1;
    const poolDropSpacing = Math.min(
      cardWidth + 8,
      (poolWidth - cardWidth - 20) / Math.max(1, poolDropCount - 1),
    );
    this.dropZones.push({
      id: "pool",
      rect: pool,
      container: body,
      visual: poolBg,
      dropX: 10 + (poolDropCount - 1) * poolDropSpacing,
      dropY: pool.y + 10,
      targetAlpha: 1,
    });
    poolIds.forEach((id, index) => {
      const card = byId.get(id);
      if (!card) return;
      const tile = this.createCardTile(
        card,
        this.scrySelectedId === id,
        false,
        cardWidth,
        cardHeight,
        () => {
          this.scrySelectedId = this.scrySelectedId === id ? null : id;
          this.rebuild();
        },
      );
      const tileX =
        10 +
        index *
          Math.min(cardWidth + 8, (poolWidth - cardWidth - 20) / Math.max(1, poolIds.length - 1));
      const tileY = pool.y + 10;
      this.makeDraggable(
        tile,
        (x, y) => this.dropScryCard(id, x, y),
        (x, y) => this.scryDropPosition(id, x, y),
      );
      this.placeScryCardTile(body, tile, id, tileX, tileY);
    });
    const zoneGap = 12;
    const zoneY = pool.y + pool.height + 34;
    const zoneWidth = (poolWidth - zoneGap * (zones.length - 1)) / Math.max(1, zones.length);
    const zoneHeight = Math.max(cardHeight + 20, height - body.y - zoneY - 70);
    zones.forEach((destination, index) => {
      const key = `zone-${index}`;
      const rect = new Rectangle(index * (zoneWidth + zoneGap), zoneY, zoneWidth, zoneHeight);
      const zoneBg = new Graphics()
        .roundRect(rect.x, rect.y, rect.width, rect.height, 8)
        .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.45 })
        .stroke({
          color: hexToNum(this.theme.appTheme["muted-foreground"]),
          width: 2,
          alpha: 0.45,
        });
      zoneBg.eventMode = "static";
      zoneBg.cursor = this.scrySelectedId ? "pointer" : "default";
      zoneBg.accessible = true;
      zoneBg.accessibleTitle = `Move selected card to ${this.scryDestinationLabel(destination)}`;
      zoneBg.tabIndex = this.scrySelectedId ? 0 : -1;
      zoneBg.on("pointertap", () => {
        if (this.scrySelectedId) this.moveScryCard(this.scrySelectedId, key);
      });
      body.addChild(zoneBg);
      const label = promptText(
        this.scryDestinationLabel(destination),
        11,
        this.theme.appTheme["muted-foreground"],
        { weight: "700" },
      );
      label.position.set(rect.x + 8, rect.y - 22);
      body.addChild(label);
      const ids = this.scryItems[key] ?? [];
      this.dropZones.push({
        id: key,
        rect,
        container: body,
        visual: zoneBg,
        dropX: rect.x + (rect.width - cardWidth) / 2,
        dropY: rect.y + 10 + ids.length * 18,
        targetAlpha: 1,
      });
      ids.forEach((id, cardIndex) => {
        const card = byId.get(id);
        if (!card) return;
        const tile = this.createCardTile(
          card,
          this.scrySelectedId === id,
          cardIndex !== ids.length - 1,
          cardWidth,
          cardHeight,
          cardIndex === ids.length - 1
            ? () => {
                this.scrySelectedId = this.scrySelectedId === id ? null : id;
                this.rebuild();
              }
            : undefined,
        );
        const tileX = rect.x + (rect.width - cardWidth) / 2;
        const tileY = rect.y + 10 + cardIndex * 18;
        if (cardIndex === ids.length - 1) {
          this.makeDraggable(
            tile,
            (x, y) => this.dropScryCard(id, x, y),
            (x, y) => this.scryDropPosition(id, x, y),
          );
        }
        this.placeScryCardTile(body, tile, id, tileX, tileY);
      });
      if (ids.length === 0) this.addScryDestinationHint(body, destination, rect);
    });
    const allPlaced = poolIds.length === 0;
    const footerY = zoneY + zoneHeight + 18;
    const shortcuts = this.promptCardShortcutHint();
    const status = promptText(
      `${cards.length - poolIds.length}/${cards.length} placed · Drag cards or select a destination${
        shortcuts ? ` · ${shortcuts}` : ""
      }`,
      11,
      this.theme.appTheme["muted-foreground"],
      { width: Math.max(1, poolWidth - 140) },
    );
    status.position.set(0, footerY + 8);
    body.addChild(status);
    const confirm = this.makeButton(
      "CONFIRM",
      () => {
        this.spec!.respond({
          type: "scryDecision",
          zoneCardIds: zones.map((_, index) =>
            [...(this.scryItems[`zone-${index}`] ?? [])].reverse(),
          ),
        });
      },
      { disabled: !allPlaced, width: 120 },
    );
    confirm.position.set(poolWidth - confirm.buttonWidth, footerY);
    body.addChild(confirm);
    this.scryPreviousPositions.clear();
  }

  private findDropZone(x: number, y: number): DropZone | undefined {
    return this.dropZones.find((zone) => {
      const point = zone.container.toLocal({ x, y });
      return zone.rect.contains(point.x, point.y);
    });
  }

  private dropScryCard(cardId: string, x: number, y: number): void {
    const target = this.findDropZone(x, y);
    if (!target) {
      this.rebuild();
      return;
    }
    this.moveScryCard(cardId, target.id);
  }

  private moveScryCard(cardId: string, targetId: string): void {
    const source = this.scryCardSource(cardId);
    if (!source || source === targetId) {
      this.rebuild();
      return;
    }
    this.captureScryCardPositions();
    this.scryItems[source] = this.scryItems[source]!.filter((id) => id !== cardId);
    this.scryItems[targetId] = [...(this.scryItems[targetId] ?? []), cardId];
    this.scrySelectedId = null;
    this.rebuild();
  }

  private scryCardSource(cardId: string): string | undefined {
    return Object.entries(this.scryItems).find(([, ids]) => ids.includes(cardId))?.[0];
  }

  private scryDropPosition(cardId: string, x: number, y: number): { x: number; y: number } | null {
    const target = this.findDropZone(x, y);
    if (!target || target.id === this.scryCardSource(cardId)) return null;
    return { x: target.dropX, y: target.dropY };
  }

  private captureScryCardPositions(): void {
    this.scryPreviousPositions.clear();
    for (const [cardId, tile] of this.scryCardTiles) {
      const position = tile.toGlobal({ x: 0, y: 0 });
      this.scryPreviousPositions.set(cardId, { x: position.x, y: position.y });
    }
  }

  private placeScryCardTile(
    body: Container,
    tile: Container,
    cardId: string,
    x: number,
    y: number,
  ): void {
    tile.position.set(x, y);
    body.addChild(tile);
    this.scryCardTiles.set(cardId, tile);
    const previous = this.scryPreviousPositions.get(cardId);
    if (!previous || !animationsEnabled()) return;
    const start = body.toLocal(previous);
    if (Math.hypot(x - start.x, y - start.y) < 0.5) return;
    tile.position.copyFrom(start);
    gsap.to(tile.position, {
      x,
      y,
      duration: SCRY_LAYOUT_SETTLE_SECONDS,
      ease: "power3.out",
    });
  }

  private clearScryCardTiles(): void {
    for (const tile of this.scryCardTiles.values()) gsap.killTweensOf(tile.position);
    this.scryCardTiles.clear();
  }

  private scryDestinationLabel(destination: ScryDestination): string {
    switch (destination) {
      case "libraryTop":
        return "TOP OF LIBRARY";
      case "libraryBottom":
        return "BOTTOM OF LIBRARY";
      case "graveyard":
        return "GRAVEYARD";
      case "exile":
        return "EXILE";
      case "hand":
        return "HAND";
    }
  }

  private addScryDestinationHint(
    body: Container,
    destination: ScryDestination,
    rect: Rectangle,
  ): void {
    const color = this.theme.appTheme["muted-foreground"];
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2 - 8;
    if (destination === "libraryTop" || destination === "libraryBottom") {
      if (destination === "libraryTop") {
        const deck = this.makeIcon("deck", 42, color);
        deck.position.set(centerX + 4, centerY);
        body.addChild(deck);
      } else {
        const card = new Graphics();
        for (let x = -24; x < 24; x += 10) {
          card.moveTo(x, -18).lineTo(Math.min(x + 6, 24), -18);
          card.moveTo(x, 18).lineTo(Math.min(x + 6, 24), 18);
        }
        for (let y = -18; y < 18; y += 10) {
          card.moveTo(-24, y).lineTo(-24, Math.min(y + 6, 18));
          card.moveTo(24, y).lineTo(24, Math.min(y + 6, 18));
        }
        card.stroke({ color: hexToNum(color), width: 2, alpha: 0.7 });
        card.position.set(centerX + 4, centerY);
        body.addChild(card);
      }
      const arrow = this.makeIcon("arrow-dunk", 26, color);
      arrow.position.set(centerX - 17, centerY - 24);
      body.addChild(arrow);
    } else {
      const icon = this.makeIcon(destination, 44, color);
      icon.position.set(centerX, centerY);
      body.addChild(icon);
    }
    const hint = promptText(this.scryDestinationHint(destination), 11, color, {
      weight: "600",
      align: "center",
    });
    hint.anchor.set(0.5, 0);
    hint.position.set(centerX, centerY + 32);
    body.addChild(hint);
  }

  private scryDestinationHint(destination: ScryDestination): string {
    switch (destination) {
      case "libraryTop":
        return "Put on top";
      case "libraryBottom":
        return "Send to bottom";
      case "graveyard":
        return "To graveyard";
      case "exile":
        return "Exile";
      case "hand":
        return "To hand";
    }
  }
  private renderDamageOrder(): void {
    const damageOrder = this.spec!.damageOrder;
    if (!damageOrder) return;
    const width = Math.min(500, this.viewportWidth - 24);
    const height = Math.min(this.viewportHeight - 24, 260 + damageOrder.blockerCards.length * 64);
    const input = this.spec!.currentPrompt?.input;
    const targets: TargetRef[] =
      input?.type === "chooseDamageAssignmentOrder"
        ? [
            { kind: "card", id: input.attackerId, intent: "damage" },
            ...damageOrder.blockerCards.map((card) => ({
              kind: "card" as const,
              id: card.id,
              intent: "damage" as const,
            })),
          ]
        : damageOrder.blockerCards.map((card) => ({
            kind: "card" as const,
            id: card.id,
            intent: "damage" as const,
          }));
    const presentation: PromptPresentation = {
      title: "Order Combat Damage",
      description: `${damageOrder.attackerName} is blocked by ${damageOrder.blockerCards.length} creatures — choose the order it assigns damage.`,
      targets,
    };
    const { body } = this.createModalShell(width, height, presentation, false, true);
    const complete =
      damageOrder.order.length >= damageOrder.blockerCards.length &&
      damageOrder.blockerCards.length > 0;
    const instruction = promptText(
      damageOrder.order.length === 0
        ? "Choose blockers in the order damage is dealt."
        : complete
          ? "Order set — confirm to deal damage."
          : `Choose the next blocker (${damageOrder.order.length}/${damageOrder.blockerCards.length}).`,
      12,
      this.theme.appTheme["muted-foreground"],
      { width: width - PANEL_PADDING * 2 },
    );
    instruction.position.set(0, 4);
    body.addChild(instruction);
    let y = instruction.height + 16;
    for (const card of damageOrder.blockerCards) {
      const index = damageOrder.order.indexOf(card.id);
      const row = new Container();
      row.position.set(0, y);
      row.eventMode = "static";
      row.cursor = "pointer";
      row.hitArea = new Rectangle(0, 0, width - PANEL_PADDING * 2, 52);
      row.accessible = true;
      row.accessibleTitle =
        index >= 0 ? `${card.identity.name}, damage order ${index + 1}` : card.identity.name;
      row.tabIndex = 0;
      const background = new Graphics()
        .roundRect(0, 0, width - PANEL_PADDING * 2, 52, 8)
        .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.62 })
        .stroke({
          color: hexToNum(index >= 0 ? this.theme.appTheme.primary : this.theme.appTheme.border),
          width: index >= 0 ? 2 : 1,
        });
      const rank = promptText(
        index >= 0 ? String(index + 1) : "—",
        16,
        this.theme.appTheme.foreground,
        {
          weight: "700",
        },
      );
      rank.anchor.set(0.5);
      rank.position.set(24, 26);
      const label = promptText(card.identity.name, 13, this.theme.appTheme.foreground, {
        weight: "600",
        width: width - PANEL_PADDING * 2 - 76,
      });
      label.position.set(48, 16);
      row.addChild(background, rank, label);
      const target: TargetRef = { kind: "card", id: card.id, intent: "damage" };
      row.on("pointerover", () => this.callbacks.onReferenceChange?.(target));
      row.on("pointerout", () => this.callbacks.onReferenceChange?.(null));
      row.on("focusin", () => this.callbacks.onReferenceChange?.(target));
      row.on("focusout", () => this.callbacks.onReferenceChange?.(null));
      row.on("pointertap", () => damageOrder.onToggle(card.id));
      body.addChild(row);
      y += 62;
    }
    const buttons = [
      this.makeButton("AUTO", damageOrder.onAuto, {
        outline: true,
        disabled: this.spec!.action.isWaitingForResponse,
      }),
    ];
    if (damageOrder.order.length > 0) {
      buttons.push(
        this.makeButton("UNDO", damageOrder.onUndo, {
          outline: true,
          disabled: this.spec!.action.isWaitingForResponse,
        }),
      );
    }
    buttons.push(
      this.makeButton("CONFIRM", damageOrder.onConfirm, {
        disabled: this.spec!.action.isWaitingForResponse || !complete,
        icon: "lucide-swords",
      }),
    );
    this.addButtonRow(body, buttons, y + 14, width - PANEL_PADDING * 2, "right");
  }

  private renderCombatDamage(input: ChooseCombatDamageAssignmentInput): void {
    const width = Math.min(500, this.viewportWidth - 24);
    const assignees = [...input.blockerIds, ...(input.defenderId ? [input.defenderId] : [])];
    const height = Math.min(this.viewportHeight - 24, 250 + assignees.length * 64);
    const attacker = this.spec!.gameView.battlefield.find((card) => card.id === input.attackerId);
    const targets: TargetRef[] = [
      { kind: "card", id: input.attackerId, intent: "damage" },
      ...input.blockerIds.map((id) => ({
        kind: "card" as const,
        id,
        intent: "damage" as const,
      })),
      ...(input.defenderId
        ? [{ kind: "player" as const, id: input.defenderId, intent: "damage" as const }]
        : []),
    ];
    const presentation: PromptPresentation = {
      title: "Assign Combat Damage",
      description: attacker
        ? `${attacker.identity.name} must assign ${input.totalDamage} damage.`
        : undefined,
      targets,
    };
    const { body } = this.createModalShell(width, height, presentation, true, true);
    const remaining =
      input.totalDamage -
      Object.values(this.damageAssigned).reduce((sum, damage) => sum + damage, 0);
    let y = 4;
    assignees.forEach((id, index) => {
      const damage = this.damageAssigned[id] ?? 0;
      const lethal =
        id === input.defenderId ? null : this.combatLethal(id, input.attackerHasDeathtouch);
      const blocked = assignees
        .slice(0, index)
        .some(
          (earlier) =>
            earlier !== input.defenderId &&
            (this.damageAssigned[earlier] ?? 0) <
              this.combatLethal(earlier, input.attackerHasDeathtouch),
        );
      const label = this.combatLabel(id);
      const rowBg = new Graphics()
        .roundRect(0, y, width - PANEL_PADDING * 2, 48, 6)
        .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.55 })
        .stroke({
          color: hexToNum(
            lethal != null && damage >= lethal
              ? this.theme.appTheme.destructive
              : this.theme.appTheme.border,
          ),
          width: 1,
        });
      rowBg.eventMode = "static";
      rowBg.cursor = "default";
      rowBg.accessible = true;
      rowBg.accessibleTitle = `Damage assigned to ${label}: ${damage}${
        lethal == null ? "" : `, lethal damage ${lethal}`
      }`;
      rowBg.tabIndex = 0;
      const target: TargetRef =
        id === input.defenderId
          ? { kind: "player", id, intent: "damage" }
          : { kind: "card", id, intent: "damage" };
      rowBg.on("pointerover", () => this.callbacks.onReferenceChange?.(target));
      rowBg.on("pointerout", () => this.callbacks.onReferenceChange?.(null));
      rowBg.on("focusin", () => this.callbacks.onReferenceChange?.(target));
      rowBg.on("focusout", () => this.callbacks.onReferenceChange?.(null));
      body.addChild(rowBg);
      const defender = this.spec!.gameView.players.find((player) => player.id === id);
      const projectedLife =
        defender && damage > 0 ? `  ·  ${defender.life} → ${defender.life - damage} life` : "";
      const text = promptText(
        `${label}${lethal != null ? `  ·  Lethal ${lethal}` : ""}${projectedLife}`,
        12,
        this.theme.appTheme.foreground,
        { weight: "600", width: width - 250 },
      );
      text.position.set(10, y + 15);
      body.addChild(text);
      if (lethal != null && lethal > 0 && damage >= lethal) {
        const skull = this.makeIcon("lucide-skull", 14, this.theme.appTheme.destructive);
        skull.position.set(width - PANEL_PADDING * 2 - 122, y + 24);
        body.addChild(skull);
      }
      if (lethal != null) {
        const lethalButton = this.makeButton(
          "LETHAL",
          () => {
            this.damageAssigned[id] = Math.min(
              input.totalDamage,
              damage + Math.max(0, lethal - damage),
            );
            this.normalizeDamage(input, assignees);
            this.rebuild();
          },
          {
            title: `Assign lethal damage to ${label}`,
            outline: true,
            disabled: blocked || damage >= lethal || remaining <= 0,
            compact: true,
            width: 54,
          },
        );
        lethalButton.position.set(width - PANEL_PADDING * 2 - 164, y + 5);
        body.addChild(lethalButton);
      }
      const minus = this.makeButton(
        "−",
        () => {
          this.damageAssigned[id] = Math.max(0, damage - 1);
          this.normalizeDamage(input, assignees);
          this.rebuild();
        },
        { outline: true, disabled: damage <= 0, compact: true, width: 34 },
      );
      const amount = promptText(String(damage), 14, this.theme.appTheme.foreground, {
        weight: "700",
      });
      const plus = this.makeButton(
        "+",
        () => {
          this.damageAssigned[id] = damage + 1;
          this.normalizeDamage(input, assignees);
          this.rebuild();
        },
        { outline: true, disabled: blocked || remaining <= 0, compact: true, width: 34 },
      );
      minus.position.set(width - PANEL_PADDING * 2 - 104, y + 5);
      amount.position.set(width - PANEL_PADDING * 2 - 60, y + 14);
      plus.position.set(width - PANEL_PADDING * 2 - 34, y + 5);
      body.addChild(minus, amount, plus);
      y += 56;
    });
    const remainingText = promptText(
      `Remaining damage: ${remaining}`,
      12,
      this.theme.appTheme["muted-foreground"],
    );
    remainingText.position.set(0, y + 8);
    body.addChild(remainingText);
    const legal = remaining === 0 && this.damageLegallyOrdered(input, assignees);
    const buttons = [
      this.makeButton(
        "RESET",
        () => {
          this.damageAssigned = {};
          this.rebuild();
        },
        { outline: true },
      ),
      this.makeButton(
        "AUTO",
        () => {
          this.autoAssignDamage(input, assignees);
          this.rebuild();
        },
        { outline: true },
      ),
      this.makeButton(
        "CONFIRM",
        () =>
          this.spec!.respond({
            type: "combatDamageAssignmentDecision",
            assignments: assignees.map((assigneeId) => ({
              assigneeId,
              damage: this.damageAssigned[assigneeId] ?? 0,
            })),
          }),
        { disabled: !legal },
      ),
    ];
    this.addButtonRow(body, buttons, y + 32, width - PANEL_PADDING * 2, "right");
  }

  private combatLabel(id: string): string {
    return (
      this.spec!.gameView.battlefield.find((card) => card.id === id)?.identity.name ??
      this.spec!.gameView.players.find((player) => player.id === id)?.name ??
      id
    );
  }

  private combatLethal(id: string, deathtouch: boolean): number {
    const card = this.spec!.gameView.battlefield.find((candidate) => candidate.id === id);
    if (!card) return 0;
    if (card.types?.includes("Planeswalker")) {
      return Math.max(0, card.counters?.LOYALTY ?? card.counters?.Loyalty ?? 0);
    }
    if (deathtouch) return 1;
    return Math.max(0, parseCombatNumber(card.toughness) - (card.damage ?? 0));
  }

  private normalizeDamage(input: ChooseCombatDamageAssignmentInput, assignees: string[]): void {
    let blocked = false;
    for (const id of assignees) {
      if (id === input.defenderId) {
        if (blocked) this.damageAssigned[id] = 0;
        continue;
      }
      if (blocked) this.damageAssigned[id] = 0;
      if ((this.damageAssigned[id] ?? 0) < this.combatLethal(id, input.attackerHasDeathtouch))
        blocked = true;
    }
    let assigned = Object.values(this.damageAssigned).reduce((sum, damage) => sum + damage, 0);
    if (assigned <= input.totalDamage) return;
    for (let index = assignees.length - 1; index >= 0 && assigned > input.totalDamage; index -= 1) {
      const id = assignees[index]!;
      const remove = Math.min(this.damageAssigned[id] ?? 0, assigned - input.totalDamage);
      this.damageAssigned[id] = (this.damageAssigned[id] ?? 0) - remove;
      assigned -= remove;
    }
  }

  private damageLegallyOrdered(
    input: ChooseCombatDamageAssignmentInput,
    assignees: string[],
  ): boolean {
    let blocked = false;
    for (const id of assignees) {
      const damage = this.damageAssigned[id] ?? 0;
      if (blocked && damage > 0) return false;
      if (id !== input.defenderId && damage < this.combatLethal(id, input.attackerHasDeathtouch))
        blocked = true;
    }
    return true;
  }

  private autoAssignDamage(input: ChooseCombatDamageAssignmentInput, assignees: string[]): void {
    this.damageAssigned = {};
    let remaining = input.totalDamage;
    for (const id of assignees) {
      if (remaining <= 0 || id === input.defenderId) continue;
      const damage = Math.min(remaining, this.combatLethal(id, input.attackerHasDeathtouch));
      this.damageAssigned[id] = damage;
      remaining -= damage;
    }
    if (remaining > 0) {
      const target = input.defenderId ?? assignees.at(-1);
      if (target) this.damageAssigned[target] = (this.damageAssigned[target] ?? 0) + remaining;
    }
    this.normalizeDamage(input, assignees);
  }

  private createDieFace(sides: number, size: number, color: string): Graphics {
    const half = size / 2;
    const die = new Graphics();
    switch (sides) {
      case 4:
        die.poly([0, -half, half, half, -half, half]);
        break;
      case 6:
        die.roundRect(-half, -half, size, size, size * 0.16);
        break;
      case 8:
        die.poly([0, -half, half, 0, 0, half, -half, 0]);
        break;
      case 10:
        die.poly([
          0,
          -half,
          half * 0.82,
          -half * 0.18,
          half * 0.48,
          half,
          -half * 0.48,
          half,
          -half * 0.82,
          -half * 0.18,
        ]);
        break;
      case 12:
        die.poly([
          -half * 0.55,
          -half,
          half * 0.55,
          -half,
          half,
          -half * 0.25,
          half * 0.8,
          half * 0.72,
          0,
          half,
          -half * 0.8,
          half * 0.72,
          -half,
          -half * 0.25,
        ]);
        break;
      case 20:
        die.poly([
          -half * 0.42,
          -half,
          half * 0.42,
          -half,
          half,
          -half * 0.42,
          half,
          half * 0.42,
          half * 0.42,
          half,
          -half * 0.42,
          half,
          -half,
          half * 0.42,
          -half,
          -half * 0.42,
        ]);
        break;
      default:
        die.circle(0, 0, half);
        break;
    }
    die
      .fill({ color: hexToNum(color), alpha: 0.95 })
      .stroke({ color: hexToNum(this.theme.appTheme.border), width: 2 });
    return die;
  }

  private renderDice(
    presentation: PromptPresentation,
    sides: number,
    rolls: Array<{
      label?: string;
      finalResults: number[];
      ignoredRolls: number[];
      highlighted: boolean;
    }>,
  ): void {
    this.diceVisuals = [];
    this.diceWinnerText = null;
    this.diceConfirm = null;
    this.diceSettled = !animationsEnabled() || this.diceElapsedMs >= DICE_ROLL_MS;
    const entries = rolls.flatMap((roll, rollIndex) =>
      roll.finalResults.map((value, resultIndex) => ({
        value,
        label:
          roll.finalResults.length > 1
            ? `${roll.label ?? `Roll ${rollIndex + 1}`} ${resultIndex + 1}`
            : roll.label,
        highlighted: roll.highlighted,
      })),
    );
    const width = Math.min(520, this.viewportWidth - 24);
    const columns = Math.max(1, Math.min(5, entries.length));
    const rows = Math.max(1, Math.ceil(entries.length / columns));
    const dieSize = Math.min(64, (width - PANEL_PADDING * 2 - ROW_GAP * (columns - 1)) / columns);
    const rowPitch = dieSize + 34;
    const height = Math.min(Math.max(330, 190 + rows * rowPitch), this.viewportHeight - 24);
    const title =
      rolls.length === 1 && !rolls[0]?.label
        ? `Rolled ${(rolls[0]?.finalResults ?? []).join(", ")} (d${sides})`
        : presentation.title || "Dice roll";
    const { body } = this.createModalShell(width, height, { ...presentation, title });
    const settled = this.diceSettled;
    entries.forEach((entry, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const rowCount = Math.min(columns, entries.length - row * columns);
      const rowWidth = rowCount * dieSize + (rowCount - 1) * ROW_GAP;
      const rowStart = (width - PANEL_PADDING * 2 - rowWidth) / 2;
      const x = rowStart + column * (dieSize + ROW_GAP) + dieSize / 2;
      const y = 18 + row * rowPitch + dieSize / 2;
      const shownValue = settled
        ? entry.value
        : ((Math.floor(this.diceElapsedMs / 75) + index * 7) % Math.max(1, sides)) + 1;
      const die = this.createDieFace(
        sides,
        dieSize,
        entry.highlighted ? this.theme.gameTheme.success : this.theme.appTheme.muted,
      );
      die.position.set(x, y);
      die.rotation =
        Math.sin(this.diceElapsedMs / 90 + index) *
        Math.max(0, 1 - this.diceElapsedMs / DICE_ROLL_MS) *
        0.35;
      body.addChild(die);
      const valueText = promptText(String(shownValue), 26, this.theme.appTheme.foreground, {
        weight: "700",
      });
      valueText.anchor.set(0.5);
      valueText.position.set(x, y);
      body.addChild(valueText);
      this.diceVisuals.push({
        die,
        value: valueText,
        finalValue: entry.value,
        index,
        sides,
      });
      if (entry.label) {
        const label = promptText(entry.label, 10, this.theme.appTheme["muted-foreground"], {
          weight: "600",
          width: dieSize + ROW_GAP,
          align: "center",
        });
        label.anchor.set(0.5, 0);
        label.position.set(x, y + dieSize / 2 + 5);
        body.addChild(label);
      }
    });
    const resultBottom = 18 + rows * rowPitch;
    const winner = rolls.find((roll) => roll.highlighted);
    if (winner) {
      const winnerText = promptText(
        `First player: ${winner.label ?? winner.finalResults.join(", ")}`,
        13,
        this.theme.gameTheme.success,
        { weight: "700" },
      );
      winnerText.anchor.set(0.5);
      winnerText.position.set((width - PANEL_PADDING * 2) / 2, resultBottom + 4);
      winnerText.visible = settled;
      this.diceWinnerText = winnerText;
      body.addChild(winnerText);
    }
    const ignored = rolls.flatMap((roll) => roll.ignoredRolls);
    if (ignored.length) {
      const ignoredText = promptText(
        `Ignored rolls: ${ignored.map((value) => `×${value}`).join("  ")}`,
        11,
        this.theme.appTheme["muted-foreground"],
      );
      ignoredText.anchor.set(0.5);
      ignoredText.position.set((width - PANEL_PADDING * 2) / 2, resultBottom + 28);
      body.addChild(ignoredText);
    }
    const confirm = this.makeButton(
      "CONTINUE",
      () => this.spec!.respond({ type: "diceRolledAcknowledged" }),
      { disabled: !settled, width: 120 },
    );
    this.diceConfirm = confirm;
    confirm.position.set(width - PANEL_PADDING * 2 - confirm.buttonWidth, height - body.y - 48);
    body.addChild(confirm);
    this.syncDiceVisuals();
  }

  private renderGameOver(): void {
    const gameOver = this.spec!.gameOver!;
    const anyConceded =
      gameOver.me.status === "conceded" ||
      gameOver.opponents.some((player) => player.status === "conceded");
    let heading = "Draw";
    let color = this.theme.appTheme["muted-foreground"];
    if (gameOver.me.status === "conceded") {
      heading = "You Conceded";
      color = this.theme.appTheme.destructive;
    } else if (gameOver.winnerId === gameOver.me.id) {
      heading = "Victory";
      color = this.theme.gameTheme.success;
    } else if (gameOver.winnerId != null) {
      heading = "Defeat";
      color = this.theme.appTheme.destructive;
    } else if (anyConceded) {
      const names = gameOver.opponents
        .filter((player) => player.status === "conceded")
        .map((player) => player.name);
      if (names.length) heading = `${names.join(" and ")} Conceded`;
    }
    const backdrop = new Graphics()
      .rect(0, 0, this.viewportWidth, this.viewportHeight)
      .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.72 });
    backdrop.eventMode = "static";
    this.container.addChild(backdrop);
    const panelWidth = Math.min(520, this.viewportWidth - 24);
    const panelHeight = 250;
    const group = this.panel(panelWidth, panelHeight, 0, 0, 12);
    group.accessible = true;
    group.accessibleTitle = `Game over: ${heading}`;
    group.tabIndex = 0;
    const accent = new Graphics()
      .roundRect(0, 0, panelWidth, 4, 12)
      .fill({ color: hexToNum(color) });
    group.addChild(accent);
    const title = promptText(heading, 36, color, { weight: "700" });
    title.anchor.set(0.5);
    title.position.set(panelWidth / 2, 56);
    group.addChild(title);
    const life = promptText(
      `You ${gameOver.me.life} life  ·  ${gameOver.opponents
        .map((player) => `${player.name} ${player.life}`)
        .join("  ·  ")}`,
      14,
      this.theme.appTheme.foreground,
      { align: "center", width: panelWidth - 40, weight: "600" },
    );
    life.anchor.set(0.5, 0);
    life.position.set(panelWidth / 2, 94);
    group.addChild(life);
    const turn = promptText(
      `Game ended on turn ${gameOver.turn}`,
      12,
      this.theme.appTheme["muted-foreground"],
    );
    turn.anchor.set(0.5);
    turn.position.set(panelWidth / 2, 140);
    group.addChild(turn);
    const button = this.makeButton("RETURN TO MENU", gameOver.onEndGame, {
      color,
      width: 170,
      height: 48,
      icon: "lucide-log-out",
    });
    button.position.set((panelWidth - button.buttonWidth) / 2, 176);
    group.addChild(button);
    group.position.set(
      (this.viewportWidth - panelWidth) / 2,
      (this.viewportHeight - panelHeight) / 2,
    );
    this.container.addChild(group);
    if (animationsEnabled()) {
      gsap.from(group.scale, {
        x: 0.96,
        y: 0.96,
        duration: 0.35,
        ease: "back.out(1.4)",
      });
    }
  }

  private makeDraggable(
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
      const point = parent.toLocal(event.global);
      const bounds =
        item.hitArea instanceof Rectangle ? item.hitArea : item.getLocalBounds().rectangle;
      const ring = new Graphics()
        .roundRect(bounds.x, bounds.y, bounds.width, bounds.height, 6)
        .stroke({ color: hexToNum(this.theme.gameTheme.cardRing), width: 4 });
      ring.eventMode = "none";
      ring.alpha = animationsEnabled() ? 0 : 1;
      item.addChild(ring);
      this.drag = {
        item,
        pointerId: event.pointerId,
        originX: item.x,
        originY: item.y,
        offsetX: point.x - item.x,
        offsetY: point.y - item.y,
        settling: false,
        restRotation: item.rotation,
        restScaleX: item.scale.x,
        restScaleY: item.scale.y,
        restOriginX: item.origin.x,
        restOriginY: item.origin.y,
        lastGlobalX: event.global.x,
        ring,
        onDrop,
        resolveDropPosition,
        onDragMove,
      };
      item.origin.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      item.cursor = "grabbing";
      item.alpha = 1;
      item.zIndex = 1000;
      gsap.killTweensOf(item.scale);
      if (animationsEnabled()) {
        gsap.to(item.scale, {
          x: this.drag.restScaleX * DRAG_LIFT_SCALE,
          y: this.drag.restScaleY * DRAG_LIFT_SCALE,
          duration: DRAG_FEEDBACK_SECONDS,
          ease: "power2.out",
          overwrite: true,
        });
        gsap.to(ring, {
          alpha: 1,
          duration: DRAG_FEEDBACK_SECONDS,
          ease: "power2.out",
          overwrite: true,
        });
      } else {
        item.scale.set(
          this.drag.restScaleX * DRAG_LIFT_SCALE,
          this.drag.restScaleY * DRAG_LIFT_SCALE,
        );
      }
      this.setDropZoneHighlight(event.global.x, event.global.y);
      onDragMove?.(event.global.x, event.global.y);
      event.stopPropagation();
    });
  }

  private moveDrag(event: FederatedPointerEvent): void {
    const drag = this.drag;
    const parent = drag?.item.parent;
    if (!drag || !parent || drag.settling || event.pointerId !== drag.pointerId) return;
    const parentPoint = parent.toLocal(event.global);
    drag.item.position.set(parentPoint.x - drag.offsetX, parentPoint.y - drag.offsetY);
    const movementX = event.global.x - drag.lastGlobalX;
    drag.lastGlobalX = event.global.x;
    const rotation =
      drag.restRotation +
      Math.max(
        -DRAG_MAX_TILT_RADIANS,
        Math.min(DRAG_MAX_TILT_RADIANS, movementX * DRAG_TILT_RADIANS_PER_PIXEL),
      );
    gsap.killTweensOf(drag.item);
    if (animationsEnabled()) {
      gsap.to(drag.item, {
        rotation,
        duration: DRAG_FEEDBACK_SECONDS,
        ease: "power2.out",
        overwrite: true,
      });
    } else {
      drag.item.rotation = rotation;
    }
    this.setDropZoneHighlight(event.global.x, event.global.y);
    drag.onDragMove?.(event.global.x, event.global.y);
  }

  private finishDrag(event: FederatedPointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.settling || event.pointerId !== drag.pointerId) return;
    const dropPosition = drag.resolveDropPosition?.(event.global.x, event.global.y);
    if (!drag.resolveDropPosition || !animationsEnabled()) {
      this.resetDropZones();
      this.drag = null;
      this.settleDragFeedback(drag, 0);
      drag.onDrop(event.global.x, event.global.y);
      return;
    }
    const destination = dropPosition ?? { x: drag.originX, y: drag.originY };
    const distance = Math.hypot(destination.x - drag.item.x, destination.y - drag.item.y);
    const duration = Math.min(
      DRAG_DROP_MAX_SECONDS,
      Math.max(DRAG_DROP_MIN_SECONDS, distance / DRAG_DROP_PIXELS_PER_SECOND),
    );
    drag.settling = true;
    drag.item.cursor = "default";
    drag.item.eventMode = "none";
    this.setDropZoneHighlight(event.global.x, event.global.y);
    this.settleDragFeedback(drag, duration);
    gsap.killTweensOf(drag.item.position);
    gsap.to(drag.item.position, {
      x: destination.x,
      y: destination.y,
      duration,
      ease: "power3.out",
      onComplete: () => {
        if (this.drag !== drag) return;
        this.resetDropZones();
        this.drag = null;
        drag.onDrop(event.global.x, event.global.y);
      },
    });
  }

  private settleDragFeedback(drag: DragState, duration: number): void {
    gsap.killTweensOf(drag.item);
    gsap.killTweensOf(drag.item.scale);
    gsap.killTweensOf(drag.ring);
    if (duration === 0 || !animationsEnabled()) {
      drag.item.rotation = drag.restRotation;
      drag.item.scale.set(drag.restScaleX, drag.restScaleY);
      drag.item.origin.set(drag.restOriginX, drag.restOriginY);
      drag.ring.destroy();
      return;
    }
    gsap.to(drag.item, {
      rotation: drag.restRotation,
      duration,
      ease: "power2.out",
      overwrite: true,
    });
    gsap.to(drag.item.scale, {
      x: drag.restScaleX,
      y: drag.restScaleY,
      duration,
      ease: "power2.out",
      overwrite: true,
      onComplete: () => {
        if (!drag.item.destroyed) drag.item.origin.set(drag.restOriginX, drag.restOriginY);
      },
    });
    gsap.to(drag.ring, {
      alpha: 0,
      duration,
      ease: "power2.out",
      overwrite: true,
      onComplete: () => {
        if (!drag.ring.destroyed) drag.ring.destroy();
      },
    });
  }

  private setDropZoneHighlight(x: number, y: number): void {
    const activeId = this.findDropZone(x, y)?.id;
    for (const zone of this.dropZones) {
      const alpha = zone.id === activeId ? 1 : DROP_ZONE_DIM_ALPHA;
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

  private resetDropZones(): void {
    for (const zone of this.dropZones) {
      gsap.killTweensOf(zone.visual);
      zone.targetAlpha = 1;
      zone.visual.alpha = 1;
    }
  }

  private cancelDrag(): void {
    const drag = this.drag;
    this.drag = null;
    if (drag) {
      gsap.killTweensOf(drag.item.position);
      this.settleDragFeedback(drag, 0);
      drag.item.cursor = "grab";
      drag.item.alpha = 1;
    }
    this.resetDropZones();
  }

  private cancelPointerDrag(event: FederatedPointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.cancelDrag();
    this.rebuild();
  }

  private handleKey(event: KeyboardEvent): void {
    if (!this.spec || !this.modalOpen) return;
    if (this.handlePromptCardShortcut(event)) return;
    if (this.combatBreakdownOpen && event.key === "Escape") {
      event.preventDefault();
      this.combatBreakdownOpen = false;
      this.rebuild();
      return;
    }
    if (this.spec.gameOver && event.key === "Enter") {
      event.preventDefault();
      this.spec.gameOver.onEndGame();
      return;
    }
    const input = this.spec.currentPrompt?.input;
    if (
      input?.type === "chooseFromSelection" &&
      input.options.length > 5 &&
      (event.key === "Backspace" ||
        (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey))
    ) {
      event.preventDefault();
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
    if (
      event.key === "Escape" &&
      input?.type !== "chooseDamageAssignmentOrder" &&
      !this.spec.gameOver
    ) {
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
        event.key === "Enter" &&
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
    if (event.code !== "Space" && event.key !== "Enter") return;
    if (input.type === "chooseBoolean" && event.code === "Space") {
      event.preventDefault();
      this.spec.respond({ type: "decision", value: true });
    } else if (input.type === "revealCards" && event.key === "Enter") {
      event.preventDefault();
      this.spec.respond({ type: "revealCardsAcknowledged" });
    } else if (input.type === "chooseCards" && event.key === "Enter") {
      const chosen = [...this.selectedIds];
      if (chosen.length >= input.min && chosen.length <= input.max) {
        event.preventDefault();
        this.spec.respond({ type: "chooseCardsDecision", chosenCardIds: chosen });
      }
    } else if (input.type === "chooseColor" && event.key === "Enter") {
      const total = [...this.counts.values()].reduce((sum, value) => sum + value, 0);
      if (total === input.amount) {
        const chosenColors: Record<string, number> = {};
        for (const [color, count] of this.counts) {
          if (typeof color === "string" && count > 0) chosenColors[color] = count;
        }
        event.preventDefault();
        this.spec.respond({ type: "colorDecision", chosenColors });
      }
    } else if (input.type === "chooseFromSelection" && event.key === "Enter") {
      const total = this.selectionTotal(input.options);
      if (total >= input.minTotal && total <= input.maxTotal) {
        event.preventDefault();
        const chosenIndices = [...this.counts.entries()]
          .sort(([left], [right]) => Number(left) - Number(right))
          .flatMap(([index, count]) => Array.from({ length: count }, () => Number(index)));
        this.spec.respond({ type: "selectionDecision", chosenIndices });
      }
    } else if (input.type === "reorder" && event.key === "Enter") {
      event.preventDefault();
      this.spec.respond({ type: "reorderDecision", orderedIds: [...this.order] });
    } else if (input.type === "scry" && event.key === "Enter") {
      if ((this.scryItems.pool ?? []).length === 0) {
        event.preventDefault();
        this.spec.respond({
          type: "scryDecision",
          zoneCardIds: input.zones.map((_, index) =>
            [...(this.scryItems[`zone-${index}`] ?? [])].reverse(),
          ),
        });
      }
    } else if (input.type === "chooseDamageAssignmentOrder" && event.key === "Enter") {
      if (
        this.spec.damageOrder &&
        this.spec.damageOrder.order.length >= this.spec.damageOrder.blockerCards.length
      ) {
        event.preventDefault();
        this.spec.damageOrder.onConfirm();
      }
    } else if (
      input.type === "diceRolled" &&
      event.key === "Enter" &&
      this.diceElapsedMs >= DICE_ROLL_MS
    ) {
      event.preventDefault();
      this.spec.respond({ type: "diceRolledAcknowledged" });
    } else if (input.type === "chooseCombatDamageAssignment" && event.key === "Enter") {
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

  private syncDiceVisuals(): void {
    const settled = !animationsEnabled() || this.diceElapsedMs >= DICE_ROLL_MS;
    for (const visual of this.diceVisuals) {
      visual.value.text = String(
        settled
          ? visual.finalValue
          : ((Math.floor(this.diceElapsedMs / 70) + visual.index * 7) % Math.max(1, visual.sides)) +
              1,
      );
      visual.die.rotation = settled
        ? 0
        : Math.sin(this.diceElapsedMs / 80 + visual.index) *
          Math.max(0, 1 - this.diceElapsedMs / DICE_ROLL_MS) *
          0.35;
    }
    if (!settled || this.diceSettled) return;
    this.diceSettled = true;
    if (this.diceWinnerText) this.diceWinnerText.visible = true;
    this.diceConfirm?.setDisabled(false);
    if (!animationsEnabled()) return;
    for (const visual of this.diceVisuals) {
      gsap.fromTo(
        visual.die.scale,
        { x: 0.86, y: 0.86 },
        { x: 1, y: 1, duration: 0.28, ease: "back.out(2)" },
      );
    }
  }

  update(deltaMs: number): void {
    const elapsed = performance.now();
    if (animationsEnabled()) {
      const actionPulse = (1 - Math.cos((elapsed / 1800) * Math.PI * 2)) / 2;
      if (this.actionGlow) {
        this.actionGlow[0].alpha = 0.3 * (1 - actionPulse);
        this.actionGlow[1].alpha = 0.6 * actionPulse;
        this.actionGlow[2].alpha = 0.75 * (1 - actionPulse);
        this.actionGlow[3].alpha = actionPulse;
      }
      for (const { node, maxAlpha } of this.actionPulseNodes) {
        node.alpha = maxAlpha * (0.5 + actionPulse * 0.5);
      }
      if (this.actionHourglass) {
        const phase = (elapsed % 2400) / 2400;
        this.actionHourglass.rotation =
          phase < 0.4
            ? 0
            : phase < 0.5
              ? ((1 - Math.cos(((phase - 0.4) / 0.1) * Math.PI)) / 2) * Math.PI
              : phase < 0.9
                ? Math.PI
                : Math.PI + ((1 - Math.cos(((phase - 0.9) / 0.1) * Math.PI)) / 2) * Math.PI;
      }
    } else {
      if (this.actionGlow) {
        this.actionGlow[0].alpha = 0.3;
        this.actionGlow[1].alpha = 0;
        this.actionGlow[2].alpha = 0.75;
        this.actionGlow[3].alpha = 0;
      }
      for (const { node, maxAlpha } of this.actionPulseNodes) node.alpha = maxAlpha;
      if (this.actionHourglass) this.actionHourglass.rotation = 0;
    }

    if (this.autopassRemainingMs != null) {
      const input = this.spec?.currentPrompt?.input;
      const canAutopass =
        input?.type === "chooseAction" &&
        this.spec?.gameView.stack.length === 0 &&
        input.actions.every(
          (action) => action.type === "activateAbility" && action.isManaAbility,
        ) &&
        !this.spec.action.isWaitingForResponse &&
        !usePromptPreferencesStore.getState().fullControl;
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
    if (!this.modalOpen || input?.type !== "diceRolled" || this.diceElapsedMs >= DICE_FINISH_MS)
      return;
    this.diceElapsedMs = animationsEnabled()
      ? Math.min(DICE_FINISH_MS, this.diceElapsedMs + deltaMs)
      : DICE_FINISH_MS;
    this.syncDiceVisuals();
  }
}
