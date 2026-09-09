import { topModal } from "@/lib/modalStack";
import { summarizeCombat } from "@/components/game/combatSummary";
import {
  Application,
  Container,
  type FederatedWheelEvent,
  FederatedPointerEvent,
  Graphics,
  Particle,
  ParticleContainer,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TextStyle,
  type Ticker,
} from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { OPPONENT_SEATS } from "@/components/game/game.types";
import { darken, readableTextColor } from "@/themes/gameTheme";
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
  CARD_RADIUS,
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
import {
  createRollToken,
  setRollTokenValue,
  type RollTokenKind,
  type RollTokenVisual,
} from "./dice/DiceGeometry";
import {
  ROLL_FLIGHT_MS,
  ROLL_IMPACT_MS,
  ROLL_SETTLE_MS,
  rollBurst,
  rollDelayMs,
  rollDuration,
  rollingDieValue,
  rollRandom,
  rollSeed,
  rollTrajectory,
} from "./dice/DiceAnimation";

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
  "coinFlipped",
  "diceRolled",
  "planarDieRolled",
]);
const FONT = "Inter, system-ui, sans-serif";
const PANEL_PADDING = 20;
const ROW_GAP = 10;
const CARD_WIDTH = 240;
const CARD_HOVER_Z_INDEX = 600;
const CARD_TILE_EDGE_INSET = 8;
const REORDER_MODAL_VERTICAL_RESERVE = 280;
const REORDER_ORDER_ZONE_ID = "reorder-order";
const REORDER_CARD_INSET = 18;
const REORDER_LAYOUT_SETTLE_SECONDS = 0.24;
const CARD_ASPECT_RATIO = CARD_H / CARD_W;
const CARD_VERTICAL_RESERVE = 288;
const SCRY_BODY_VERTICAL_RESERVE = 176;
const CARD_MODAL_MAX_WIDTH = 1160;
const MODAL_MIN_HEIGHT = 160;
const MODAL_VIEWPORT_MARGIN = 16;
const MODAL_BODY_BOTTOM_PADDING = 8;
const SOURCE_CARD_GAP = 20;
const SOURCE_CARD_EXTERNAL_WIDTH = 180;
const SOURCE_CARD_INTERNAL_WIDTH = 64;
const SOURCE_LABEL_HEIGHT = 18;
const DRAG_START_THRESHOLD = 4;
const DRAG_DROP_MIN_SECONDS = 0.1;
const DRAG_DROP_MAX_SECONDS = 0.22;
const DRAG_DROP_PIXELS_PER_SECOND = 1800;
const DROP_ZONE_DIM_ALPHA = 0.62;
const DROP_ZONE_TWEEN_SECONDS = 0.12;
const REORDER_PREVIEW_SECONDS = 0.14;
const FILTER_CARET_PERIOD_MS = 1000;
const SCRY_LAYOUT_SETTLE_SECONDS = 0.2;
const MODAL_SCROLL_LINE_HEIGHT = 16;
const MODAL_SCROLL_SCALE = 0.35;
const MODAL_SCROLL_MAX_STEP = 56;

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
  onDrop: (x: number, y: number) => void;
  resolveDropPosition?: (x: number, y: number) => { x: number; y: number } | null;
  onDragMove?: (x: number, y: number) => void;
}

interface RollVisual {
  token: RollTokenVisual;
  finalValue: number | string;
  index: number;
  sides: number;
  round: number;
  seed: number;
  baseX: number;
  baseY: number;
  startX: number;
  startY: number;
  restingRotation: number;
  ignored: boolean;
  ignoredMark: Graphics | null;
  aura: Graphics;
  highlighted: boolean;
  playerColor: number;
}
interface RollDisplayEntry {
  kind: RollTokenKind;
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
  private suppressedTapItems = new WeakSet<Container>();
  private scryCardTiles = new Map<string, Container>();
  private scryPreviousPositions = new Map<string, { x: number; y: number }>();
  private reorderCardVisuals = new Map<
    string,
    {
      tile: Container;
      controls: Container;
      controlsOffsetX: number;
      controlsOffsetY: number;
      rank: Graphics;
      rankText: Text;
      cardName: string;
    }
  >();
  private reorderPreviousPositions = new Map<string, { x: number; y: number }>();
  private reorderPreview: { cardId: string; index: number | null } | null = null;
  private promptCardStates = new Map<string, PromptCardDisplayState>();
  private activePromptCard: { card: CardDto; sprite: CardSprite } | null = null;
  private activePromptCardId: string | null = null;
  private rollElapsedMs = 0;
  private rollDurationMs = 0;
  private rollHighlightLabel: string | null = null;
  private autopassRemainingMs: number | null = null;
  private rollVisuals: RollVisual[] = [];
  private rollHighlightText: Text | null = null;
  private rollConfirm: PromptButton | null = null;
  private rollTimeline: gsap.core.Timeline | null = null;
  private rollSettled = false;
  private autopassTotalMs = 0;
  private autopassFill: Graphics | null = null;
  private actionPromptType: PromptOverlaySpec["action"]["promptType"] = undefined;
  private readonly unsubscribePromptPreferences: () => void;
  private readonly unsubscribePreferences: () => void;
  private readonly unsubscribeKeybindings: () => void;
  private endTurnModifiersHeld = false;
  private actionContextOpen = false;
  private actionGlow: PromptGlow | null = null;
  private actionFeedback = { glow: 0, press: 0 };
  private actionGlowTween: gsap.core.Timeline | null = null;
  private actionFeedbackEndTurn = false;
  private priorityButtons: { pass: PromptButton; end: PromptButton | null } | null = null;
  private actionPulseNodes: Array<{ node: Container; maxAlpha: number }> = [];
  private actionHourglass: Sprite | null = null;
  private entranceKey: object | string | null = null;
  private entranceTween: gsap.core.Tween | null = null;
  private actionLongPress = new LongPressGesture();
  private selectionFilter = "";
  private selectionFilterFocused = false;
  private selectionFilterBlinkAt = 0;
  private selectionFilterView: {
    container: Container;
    background: Graphics;
    caret: Graphics;
    width: number;
    y: number;
  } | null = null;
  private modalScrollOffset = 0;
  private modalScrollMax = 0;
  private modalBody: {
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
    const hadPriority =
      this.spec?.action.promptType === "chooseAction" &&
      !this.spec.action.isWaitingForResponse &&
      !this.spec.action.isWaitingForOthers;
    const hasPriority =
      spec?.action.promptType === "chooseAction" &&
      !spec.action.isWaitingForResponse &&
      !spec.action.isWaitingForOthers;
    const nextActionPromptType = spec?.action.promptType;
    if (nextActionPromptType !== this.actionPromptType) {
      this.actionPromptType = nextActionPromptType;
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
    if (modalUnavailable) this.selectionFilterFocused = false;
    if (this.drag && !promptChanged && !modalUnavailable) return;
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
    this.actionHourglass = null;
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

    const runtimeView =
      action.isWaitingForOthers && action.promptType !== "chooseAction"
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
              color: passColor,
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
    color: string,
    disabled: boolean,
    minimal: boolean,
    touch: boolean,
    options: { badge?: string; title?: string } = {},
  ): PromptButton {
    const showLabel = minimal || touch;
    return this.makeButton(label, onPress, {
      color,
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
          color: this.theme.appTheme.secondary,
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
        color: this.theme.gameTheme.promptAction.passAction,
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
        this.theme.gameTheme.textOnTinted,
      );
    }
    this.priorityButtons = { pass, end };
    return this.layoutActionRow(end ? [pass, end] : [pass], gap);
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
        horizontalFlipped: true,
      };
      this.promptCardStates.set(card.id, state);
    }
    return state;
  }

  private configurePromptCardSprite(sprite: CardSprite, card: CardDto): void {
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

  private togglePromptCardView(card: CardDto, sprite: CardSprite): void {
    const state = this.promptCardState(card);
    state.rulesView = !state.rulesView;
    this.configurePromptCardSprite(sprite, card);
  }

  private togglePromptCardFace(card: CardDto, sprite: CardSprite): void {
    const state = this.promptCardState(card);
    if (card.isDoubleFaced) state.face = state.face === 0 ? 1 : 0;
    else if (sprite.horizontalFrame) state.horizontalFlipped = !state.horizontalFlipped;
    else return;
    this.configurePromptCardSprite(sprite, card);
  }

  private bindPromptCardActivation(target: Container, card: CardDto, sprite: CardSprite): void {
    let restingZIndex: number | null = null;
    const showFeedback = () => {
      sprite.setElevation(1);
      sprite.setRing(hexToNum(this.theme.gameTheme.cardRing));
    };
    const hideFeedback = () => {
      sprite.setElevation(0);
      sprite.setRing(null);
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

  private handlePromptCardShortcut(event: KeyboardEvent): boolean {
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

  private promptCardShortcutHint(): string {
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
          ? this.theme.gameTheme.promptAction.passAction
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
        color,
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
      color,
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
        color: fullControl ? "#ffffff" : this.theme.appTheme.border,
        outline: true,
        backgroundColor: "#ffffff",
        backgroundAlpha: fullControl ? 0.15 : 0.05,
        borderColor: fullControl ? "#ffffff" : this.theme.appTheme.border,
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
    backdrop.on("pointerdown", () => this.setSelectionFilterFocused(false));
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
      case "coinFlipped":
        this.renderCoin(input.presentation, input.flips);
        break;
      case "diceRolled":
        this.renderDice(input.presentation, input.sides, input.rolls);
        break;
      case "planarDieRolled":
        this.renderPlanarDie(input.presentation, input.rolls);
        break;
    }
    this.finalizeModalScroll();
    this.animateReorderLayout();
    this.animateScryLayout();
  }

  private createModalShell(
    width: number,
    height: number,
    presentation: PromptPresentation,
    minimizable = true,
    boardContext = false,
    footerHeight = 0,
    footerContentHeight = 36,
  ): {
    panel: Container;
    body: Container;
    bodyTop: number;
    footer: Container;
  } {
    const sourceCard = this.promptSourceCard();
    const preferredSourceCardWidth = this.promptCardDimensions().width;
    const x = (this.viewportWidth - width) / 2;
    const y = (this.viewportHeight - height) / 2;
    const externalSourceCardWidth = SOURCE_CARD_EXTERNAL_WIDTH;
    const externalSource =
      !!sourceCard &&
      !boardContext &&
      (this.viewportWidth - width) / 2 - SOURCE_CARD_GAP - 12 >= externalSourceCardWidth &&
      y + SOURCE_LABEL_HEIGHT + externalSourceCardWidth * CARD_ASPECT_RATIO <=
        this.viewportHeight - 12;
    const panel = this.panel(width, height, x, y, 12);
    const panelBackground = panel.children[0] as Graphics;
    panel.eventMode = "static";
    panel.on("pointerdowncapture", (event: FederatedPointerEvent) => {
      const filter = this.selectionFilterView;
      if (!filter) return;
      let target = event.target as Container | null;
      while (target && target !== filter.container) target = target.parent;
      this.setSelectionFilterFocused(target === filter.container);
    });
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
        : Math.min(SOURCE_CARD_INTERNAL_WIDTH, preferredSourceCardWidth, width - PANEL_PADDING * 2);
      const left = externalSource ? sourceLeft : PANEL_PADDING;
      const top = externalSource ? SOURCE_LABEL_HEIGHT : 16;
      const placeSourceSprite = () => {
        const rotated =
          sourceSprite.horizontalFrame && !this.promptCardState(sourceCard).horizontalFlipped;
        sourceSprite.rotation = rotated ? -Math.PI / 2 : 0;
        const horizontal = sourceSprite.horizontalFrame && !rotated;
        const cardWidth = horizontal ? CARD_H : CARD_W;
        const cardHeight = horizontal ? CARD_W : CARD_H;
        const scale = sourceWidth / cardWidth;
        sourceSprite.scale.set(scale);
        sourceSprite.syncHandControlsScale();
        sourceSprite.position.set(left + (cardWidth * scale) / 2, top + (cardHeight * scale) / 2);
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

    const viewportHeight = Math.max(0, height - bodyTop - footerHeight - MODAL_BODY_BOTTOM_PADDING);
    const mask = new Graphics()
      .rect(PANEL_PADDING, bodyTop, width - PANEL_PADDING * 2, viewportHeight)
      .fill({ color: hexToNum(this.theme.appTheme.foreground) });
    panel.addChild(mask);
    const body = new Container();
    body.position.set(PANEL_PADDING, bodyTop);
    body.mask = mask;
    panel.addChild(body);

    const scrollTrack = new Graphics()
      .roundRect(width - 8, bodyTop, 3, viewportHeight, 2)
      .fill({ color: hexToNum(this.theme.appTheme.border), alpha: 0.5 });
    const scrollThumb = new Graphics();
    scrollTrack.visible = false;
    scrollThumb.visible = false;
    panel.addChild(scrollTrack, scrollThumb);

    const footer = new Container();
    let footerBackground: Graphics | null = null;
    if (footerHeight > 0) {
      const footerTop = height - footerHeight;
      footerBackground = new Graphics()
        .rect(0, footerTop, width, footerHeight)
        .fill({ color: hexToNum(this.theme.appTheme.card), alpha: 0.98 })
        .moveTo(0, footerTop)
        .lineTo(width, footerTop)
        .stroke({ color: hexToNum(this.theme.appTheme.border), width: 1, alpha: 0.8 });
      footer.position.set(
        PANEL_PADDING,
        footerTop + Math.max(8, (footerHeight - footerContentHeight) / 2),
      );
      panel.addChild(footerBackground, footer);
    }

    panel.on("wheel", (event: FederatedWheelEvent) => this.scrollModal(event));
    this.modalBody = {
      panel,
      panelBackground,
      body,
      bodyTop,
      width,
      height,
      hitWidth: externalSource ? sourceLeft + externalSourceCardWidth : width,
      externalSourceHeight:
        externalSource && sourceSprite ? SOURCE_LABEL_HEIGHT + sourceSprite.height : 0,
      footerHeight,
      footerContentHeight,
      footer,
      footerBackground,
      mask,
      viewportHeight,
      scrollTrack,
      scrollThumb,
    };
    this.container.addChild(panel);
    return { panel, body, bodyTop, footer };
  }

  private resizeModalShell(state: NonNullable<PromptLayer["modalBody"]>, height: number): void {
    state.height = height;
    state.viewportHeight = Math.max(
      0,
      height - state.bodyTop - state.footerHeight - MODAL_BODY_BOTTOM_PADDING,
    );
    const layoutHeight = Math.max(height, state.externalSourceHeight);
    state.panel.position.y = (this.viewportHeight - layoutHeight) / 2;
    state.panel.hitArea = new Rectangle(0, 0, state.hitWidth, layoutHeight);
    state.panelBackground
      .clear()
      .roundRect(0, 0, state.width, height, 12)
      .fill({ color: hexToNum(this.theme.appTheme.card), alpha: 0.97 })
      .stroke({ color: hexToNum(this.theme.appTheme.border), width: 1, alpha: 0.9 });
    state.mask
      .clear()
      .rect(PANEL_PADDING, state.bodyTop, state.width - PANEL_PADDING * 2, state.viewportHeight)
      .fill({ color: hexToNum(this.theme.appTheme.foreground) });
    state.scrollTrack
      .clear()
      .roundRect(state.width - 8, state.bodyTop, 3, state.viewportHeight, 2)
      .fill({ color: hexToNum(this.theme.appTheme.border), alpha: 0.5 });
    if (state.footerBackground) {
      const footerTop = height - state.footerHeight;
      state.footerBackground
        .clear()
        .rect(0, footerTop, state.width, state.footerHeight)
        .fill({ color: hexToNum(this.theme.appTheme.card), alpha: 0.98 })
        .moveTo(0, footerTop)
        .lineTo(state.width, footerTop)
        .stroke({ color: hexToNum(this.theme.appTheme.border), width: 1, alpha: 0.8 });
      state.footer.position.set(
        PANEL_PADDING,
        footerTop + Math.max(8, (state.footerHeight - state.footerContentHeight) / 2),
      );
    }
  }

  private scrollModal(event: FederatedWheelEvent): void {
    const state = this.modalBody;
    if (!state || this.modalScrollMax <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rawDelta =
      event.deltaMode === 1
        ? event.deltaY * MODAL_SCROLL_LINE_HEIGHT
        : event.deltaMode === 2
          ? event.deltaY * state.viewportHeight
          : event.deltaY;
    const delta = Math.max(
      -MODAL_SCROLL_MAX_STEP,
      Math.min(MODAL_SCROLL_MAX_STEP, rawDelta * MODAL_SCROLL_SCALE),
    );
    this.modalScrollOffset = Math.max(
      0,
      Math.min(this.modalScrollMax, this.modalScrollOffset + delta),
    );
    this.syncModalScrollPosition();
  }

  private finalizeModalScroll(): void {
    const state = this.modalBody;
    if (!state) return;
    const mask = state.body.mask;
    state.body.mask = null;
    const bounds = state.body.getLocalBounds();
    state.body.mask = mask;
    const contentHeight = Math.max(0, bounds.y + bounds.height);
    const requiredHeight = Math.ceil(
      state.bodyTop + contentHeight + state.footerHeight + MODAL_BODY_BOTTOM_PADDING,
    );
    const fittedHeight = Math.min(
      this.viewportHeight - MODAL_VIEWPORT_MARGIN,
      Math.max(MODAL_MIN_HEIGHT, requiredHeight),
    );
    this.resizeModalShell(state, fittedHeight);
    const overflow = contentHeight - state.viewportHeight;
    this.modalScrollMax = overflow > 1 ? overflow : 0;
    this.modalScrollOffset = Math.min(this.modalScrollOffset, this.modalScrollMax);
    const scrollable = this.modalScrollMax > 0 && state.viewportHeight > 0;
    state.scrollTrack.visible = scrollable;
    state.scrollThumb.visible = scrollable;
    if (scrollable) {
      const thumbHeight = Math.max(
        24,
        state.viewportHeight * Math.min(1, state.viewportHeight / contentHeight),
      );
      state.scrollThumb
        .clear()
        .roundRect(0, 0, 3, thumbHeight, 2)
        .fill({ color: hexToNum(this.theme.appTheme["muted-foreground"]), alpha: 0.85 });
      state.scrollThumb.x = state.scrollTrack.x;
    }
    this.syncModalScrollPosition();
  }

  private syncModalScrollPosition(): void {
    const state = this.modalBody;
    if (!state) return;
    state.body.y = state.bodyTop - this.modalScrollOffset;
    if (this.modalScrollMax <= 0) return;
    const thumbHeight = state.scrollThumb.height;
    const travel = Math.max(0, state.viewportHeight - thumbHeight);
    state.scrollThumb.y = state.bodyTop + travel * (this.modalScrollOffset / this.modalScrollMax);
  }

  private renderBoolean(
    presentation: PromptPresentation,
    denyLabel: string,
    confirmLabel: string,
  ): void {
    const width = Math.min(520, this.viewportWidth - 24);
    const height = Math.min(280, this.viewportHeight - 24);
    const footerHeight = 64;
    const buttonHeight = 44;
    const availableWidth = width - PANEL_PADDING * 2;
    const buttonWidth = Math.min(160, (availableWidth - ROW_GAP) / 2);
    const { footer } = this.createModalShell(
      width,
      height,
      presentation,
      true,
      false,
      footerHeight,
      buttonHeight,
    );
    const buttons = [
      this.makeButton(denyLabel, () => this.spec!.respond({ type: "decision", value: false }), {
        outline: true,
        width: buttonWidth,
        height: buttonHeight,
      }),
      this.makeButton(confirmLabel, () => this.spec!.respond({ type: "decision", value: true }), {
        width: buttonWidth,
        height: buttonHeight,
      }),
    ];
    this.addButtonRow(footer, buttons, 0, availableWidth);
  }

  private renderSelection(
    presentation: PromptPresentation,
    options: SelectionOption[],
    minTotal: number,
    maxTotal: number,
  ): void {
    const showFilter = options.length > 5;
    const indexedOptions = options.map((option, index) => ({ option, index }));
    const normalizedFilter = this.selectionFilter.toLocaleLowerCase();
    const visibleOptions = showFilter
      ? indexedOptions.filter(({ option }) =>
          option.label.toLocaleLowerCase().includes(normalizedFilter),
        )
      : indexedOptions;
    const autoConfirm = minTotal === 1 && maxTotal === 1;
    const visibleRowCount = Math.max(1, Math.min(visibleOptions.length, 7));
    const width = Math.min(560, this.viewportWidth - 24);
    const height = Math.min(
      Math.max(260, 132 + visibleRowCount * 66 + (showFilter ? 48 : 0) + (autoConfirm ? 0 : 52)),
      this.viewportHeight - 24,
    );
    const { body, footer } = this.createModalShell(
      width,
      height,
      presentation,
      true,
      false,
      autoConfirm ? 0 : 60,
    );
    const availableWidth = width - PANEL_PADDING * 2;
    const showWeights = options.some((option) => option.weight !== 1);
    let y = 4;

    if (showFilter) {
      const filter = new Container();
      body.addChild(filter);
      const filterBackground = new Graphics();
      filterBackground.eventMode = "static";
      filterBackground.cursor = "text";
      filterBackground.accessible = true;
      filterBackground.accessibleTitle = "Filter choices. Start typing to search.";
      filterBackground.tabIndex = 0;
      filterBackground.on("focusin", () => this.setSelectionFilterFocused(true));
      filterBackground.on("focusout", () => this.setSelectionFilterFocused(false));
      const searchIcon = this.makeIcon(
        "lucide-search",
        15,
        this.selectionFilter
          ? this.theme.appTheme.foreground
          : this.theme.appTheme["muted-foreground"],
      );
      searchIcon.position.set(16, y + 20);
      const filterText = promptText(
        this.selectionFilter || "Search choices",
        12,
        this.selectionFilter
          ? this.theme.appTheme.foreground
          : this.theme.appTheme["muted-foreground"],
        { width: availableWidth - 132, truncate: true },
      );
      filterText.position.set(30, y + 12);
      const resultCount = promptText(
        `${visibleOptions.length} result${visibleOptions.length === 1 ? "" : "s"}`,
        10,
        this.theme.appTheme["muted-foreground"],
        { weight: "600" },
      );
      resultCount.anchor.set(1, 0.5);
      resultCount.position.set(availableWidth - (this.selectionFilter ? 42 : 10), y + 20);
      const caret = new Graphics()
        .rect(filterText.x + (this.selectionFilter ? filterText.width + 2 : 0), y + 12, 1.5, 16)
        .fill({ color: hexToNum(this.theme.gameTheme.cardRing) });
      caret.eventMode = "none";
      filter.addChild(filterBackground, searchIcon, filterText, resultCount, caret);
      this.selectionFilterView = {
        container: filter,
        background: filterBackground,
        caret,
        width: availableWidth,
        y,
      };
      if (this.selectionFilter) {
        const clear = this.makeButton(
          "",
          () => {
            this.selectionFilter = "";
            this.selectionFilterFocused = true;
            this.rebuild();
          },
          {
            title: "Clear filter",
            icon: "lucide-x",
            outline: true,
            compact: true,
            width: 30,
            height: 30,
          },
        );
        clear.position.set(availableWidth - 34, y + 5);
        filter.addChild(clear);
      }
      this.setSelectionFilterFocused(this.selectionFilterFocused);
      y += 52;
    }

    if (visibleOptions.length === 0) {
      const empty = promptText("No choices match your search", 12, this.theme.appTheme.muted, {
        width: availableWidth,
        align: "center",
      });
      empty.position.set(0, y + 22);
      body.addChild(empty);
      y += 66;
    }

    for (const { option, index } of visibleOptions) {
      const count = this.counts.get(index) ?? 0;
      const currentTotal = this.selectionTotal(options);
      const selected = count > 0;
      const canIncrement = currentTotal + option.weight <= maxTotal;
      const disabled = !selected && !canIncrement;
      const rowHeight = 56;
      const row = new Container();
      row.position.set(0, y);
      row.eventMode = disabled ? "none" : "static";
      row.cursor = disabled ? "default" : "pointer";
      row.hitArea = new Rectangle(0, 0, availableWidth, rowHeight);
      row.accessible = true;
      row.accessibleTitle = `${option.label}${showWeights ? `, ${option.weight} point${option.weight === 1 ? "" : "s"}` : ""}${selected ? `, selected ${count} time${count === 1 ? "" : "s"}` : ""}`;
      row.accessibleHint = option.canRepeat
        ? "Activate to add one selection. Use the remove control to decrease the count."
        : autoConfirm
          ? "Activate to choose this option."
          : "Activate to toggle this option.";
      row.tabIndex = disabled ? -1 : 0;
      const rowBackground = new Graphics()
        .roundRect(0, 0, availableWidth, rowHeight, 9)
        .fill({
          color: hexToNum(
            selected ? this.theme.gameTheme.cardRing : this.theme.appTheme.background,
          ),
          alpha: selected ? 0.12 : 0.55,
        })
        .stroke({
          color: hexToNum(selected ? this.theme.gameTheme.cardRing : this.theme.appTheme.border),
          width: selected ? 2 : 1,
          alpha: selected ? 0.9 : 0.8,
        });
      row.addChild(rowBackground);

      const indicator = new Graphics()
        .circle(22, rowHeight / 2, 10)
        .fill({
          color: hexToNum(
            selected ? this.theme.gameTheme.cardRing : this.theme.appTheme.background,
          ),
          alpha: selected ? 1 : 0.55,
        })
        .stroke({
          color: hexToNum(
            selected ? this.theme.gameTheme.cardRing : this.theme.appTheme["muted-foreground"],
          ),
          width: 2,
          alpha: selected ? 1 : 0.7,
        });
      row.addChild(indicator);
      if (selected) {
        const check = this.makeIcon("lucide-check", 12, this.theme.appTheme.background);
        check.position.set(22, rowHeight / 2);
        row.addChild(check);
      }

      const quantityWidth = option.canRepeat ? 102 : 0;
      const label = promptText(option.label, 13, this.theme.appTheme.foreground, {
        weight: "600",
        width: availableWidth - 58 - quantityWidth,
        truncate: true,
      });
      label.position.set(42, showWeights ? 10 : 19);
      row.addChild(label);
      if (showWeights) {
        const weight = promptText(
          `${option.weight} point${option.weight === 1 ? "" : "s"}`,
          10,
          selected ? this.theme.gameTheme.cardRing : this.theme.appTheme["muted-foreground"],
          { weight: "600" },
        );
        weight.position.set(42, 32);
        row.addChild(weight);
      }

      const increment = () => {
        if (!option.canRepeat && selected && !autoConfirm) {
          this.counts.delete(index);
          this.rebuild();
          return;
        }
        if (!canIncrement) return;
        if (autoConfirm) {
          this.spec!.respond({ type: "selectionDecision", chosenIndices: [index] });
          return;
        }
        if (option.canRepeat) {
          this.counts.set(index, count + 1);
        } else {
          if (maxTotal === 1) this.counts.clear();
          this.counts.set(index, 1);
        }
        this.rebuild();
      };
      row.on("pointertap", increment);

      if (option.canRepeat) {
        const controlX = availableWidth - 98;
        const minus = this.makeButton(
          "",
          () => {
            if (count <= 1) this.counts.delete(index);
            else this.counts.set(index, count - 1);
            this.rebuild();
          },
          {
            title: `Remove one ${option.label}`,
            icon: "lucide-minus",
            outline: true,
            compact: true,
            disabled: count === 0,
            width: 30,
            height: 32,
          },
        );
        minus.position.set(controlX, 12);
        minus.on("pointertap", (event) => event.stopPropagation());
        const countBackground = new Graphics()
          .roundRect(controlX + 34, 12, 30, 32, 7)
          .fill({ color: hexToNum(this.theme.appTheme.muted), alpha: 0.55 });
        const countText = promptText(String(count), 13, this.theme.appTheme.foreground, {
          weight: "700",
        });
        countText.anchor.set(0.5);
        countText.position.set(controlX + 49, 28);
        const plus = this.makeButton("", increment, {
          title: `Add one ${option.label}`,
          icon: "lucide-plus",
          outline: true,
          compact: true,
          disabled: !canIncrement,
          width: 30,
          height: 32,
        });
        plus.position.set(controlX + 68, 12);
        plus.on("pointertap", (event) => event.stopPropagation());
        row.addChild(minus, countBackground, countText, plus);
      }

      row.alpha = disabled ? 0.48 : 1;
      body.addChild(row);
      y += 66;
    }

    if (!autoConfirm) {
      const selectedTotal = this.selectionTotal(options);
      const canConfirm = selectedTotal >= minTotal && selectedTotal <= maxTotal;
      const requirement =
        minTotal === maxTotal
          ? `${selectedTotal} of ${maxTotal} points selected`
          : `${selectedTotal} points selected · choose ${minTotal}–${maxTotal}`;
      const status = promptText(
        requirement,
        11,
        canConfirm ? this.theme.gameTheme.success : this.theme.appTheme["muted-foreground"],
        { weight: "600", width: availableWidth - 150, truncate: true },
      );
      status.position.set(2, 10);
      footer.addChild(status);
      const confirm = this.makeButton(
        minTotal === 0 && selectedTotal === 0 ? "SKIP" : "CONFIRM",
        () => {
          const chosenIndices = [...this.counts.entries()]
            .sort(([left], [right]) => Number(left) - Number(right))
            .flatMap(([selectedIndex, selectedCount]) =>
              Array.from({ length: selectedCount }, () => Number(selectedIndex)),
            );
          this.spec!.respond({ type: "selectionDecision", chosenIndices });
        },
        { disabled: !canConfirm, width: 130 },
      );
      confirm.position.set(availableWidth - confirm.buttonWidth, 0);
      footer.addChild(confirm);
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
    const { body, footer } = this.createModalShell(
      width,
      height,
      reveal
        ? {
            ...presentation,
            title: "Cards Revealed",
            description: `${cards.length} card${cards.length === 1 ? "" : "s"} shown`,
          }
        : presentation,
      true,
      false,
      60,
    );
    const shortcuts = this.promptCardShortcutHint();
    const startY = shortcuts ? 28 : 4;
    if (shortcuts) {
      const shortcutText = promptText(shortcuts, 10, this.theme.appTheme["muted-foreground"]);
      shortcutText.position.set(CARD_TILE_EDGE_INSET, 5);
      body.addChild(shortcutText);
    }
    cards.forEach((card, index) => {
      const selected = this.selectedIds.has(card.id);
      const disabled = !reveal && max !== 1 && this.selectedIds.size >= max && !selected;
      const tile = this.createCardTile(
        card,
        selected,
        disabled,
        cardWidth,
        cardHeight,
        reveal
          ? undefined
          : () => {
              if (disabled) return;
              if (selected) {
                this.selectedIds.delete(card.id);
              } else {
                if (max === 1) this.selectedIds.clear();
                this.selectedIds.add(card.id);
              }
              this.rebuild();
            },
      );
      const row = Math.floor(index / columns);
      const column = index % columns;
      tile.position.set(
        CARD_TILE_EDGE_INSET + column * (cardWidth + 10),
        startY + row * (cardHeight + 12),
      );
      body.addChild(tile);
    });
    const chosen = [...this.selectedIds];
    const canConfirm = reveal || (chosen.length >= min && chosen.length <= max);
    const status = promptText(
      reveal
        ? `${cards.length} card${cards.length === 1 ? "" : "s"} revealed`
        : `${chosen.length} of ${max} selected`,
      11,
      canConfirm ? this.theme.gameTheme.success : this.theme.appTheme["muted-foreground"],
      { weight: "600" },
    );
    status.position.set(0, 10);
    footer.addChild(status);
    const label = reveal ? "CONTINUE" : chosen.length === 0 && min === 0 ? "SKIP" : "CONFIRM";
    const confirm = this.makeButton(
      label,
      () => {
        if (reveal) this.spec!.respond({ type: "revealCardsAcknowledged" });
        else this.spec!.respond({ type: "chooseCardsDecision", chosenCardIds: chosen });
      },
      { disabled: !canConfirm, width: 136 },
    );
    confirm.position.set(width - PANEL_PADDING * 2 - confirm.buttonWidth, 0);
    footer.addChild(confirm);
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
    const radius = (CARD_RADIUS * width) / CARD_W;
    tile.eventMode = "static";
    tile.cursor = disabled ? "default" : onPress ? "pointer" : "default";
    tile.hitArea = new Rectangle(0, 0, width, height);
    tile.accessible = true;
    tile.accessibleTitle = `${card.identity.name}${selected ? ", selected" : ""}${
      disabled ? ", unavailable" : ""
    }`;
    tile.accessibleHint = disabled
      ? "This card is not currently available"
      : onPress
        ? selected
          ? "Activate to deselect this card"
          : "Activate to select this card"
        : "Focus or hover, then change view or flip face";
    tile.tabIndex = disabled ? -1 : 0;
    const sprite = new CardSprite(card, "hand");
    this.configurePromptCardSprite(sprite, card);
    const placeSprite = () => {
      const rotated = sprite.horizontalFrame && !this.promptCardState(card).horizontalFlipped;
      sprite.rotation = rotated ? -Math.PI / 2 : 0;
      const horizontal = sprite.horizontalFrame && !rotated;
      const cardWidth = horizontal ? CARD_H : CARD_W;
      const cardHeight = horizontal ? CARD_W : CARD_H;
      const scale = Math.min(width / cardWidth, height / cardHeight);
      sprite.scale.set(scale);
      sprite.syncHandControlsScale();
      sprite.position.set((cardWidth * scale) / 2, (cardHeight * scale) / 2);
    };
    sprite.onReorient = placeSprite;
    placeSprite();
    sprite.eventMode = "passive";
    tile.addChild(sprite);
    this.bindPromptCardActivation(tile, card, sprite);
    if (disabled) {
      const unavailable = new Graphics()
        .roundRect(0, 0, width, height, radius)
        .fill({ color: hexToNum(this.theme.appTheme.card), alpha: 0.28 });
      unavailable.eventMode = "none";
      tile.addChild(unavailable);
    }
    if (selected) {
      const ring = new Graphics()
        .roundRect(0, 0, width, height, radius)
        .stroke({ color: hexToNum(this.theme.gameTheme.cardRing), width: 4 });
      ring.eventMode = "none";
      const badge = new Graphics()
        .circle(width - 14, 14, 12)
        .fill({ color: hexToNum(this.theme.gameTheme.cardRing) })
        .stroke({ color: hexToNum(this.theme.appTheme.card), width: 2 });
      badge.eventMode = "none";
      const check = this.makeIcon("lucide-check", 13, this.theme.appTheme.background);
      check.position.set(width - 14, 14);
      tile.addChild(ring, badge, check);
    }
    tile.alpha = disabled ? 0.72 : 1;
    tile.on("pointertap", () => {
      if (this.suppressedTapItems.delete(tile)) return;
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
      amount <= 1 ? 230 : 190 + validColors.length * 64,
    );
    const { body, footer } = this.createModalShell(
      width,
      height,
      presentation,
      true,
      false,
      amount <= 1 ? 0 : 60,
    );
    const availableWidth = width - PANEL_PADDING * 2;
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
            width: 112,
            height: 64,
            iconTexture: loadManaSymbolTexture(this.manaSymbol(color)),
            iconTint: false,
            iconSize: 28,
          },
        ),
      );
      this.addButtonRow(body, buttons, 18, availableWidth);
      return;
    }

    const total = [...this.counts.values()].reduce((sum, value) => sum + value, 0);
    let y = 4;
    for (const color of validColors) {
      const count = this.counts.get(color) ?? 0;
      const colorValue = colors[color] ?? this.theme.appTheme.muted;
      const selected = count > 0;
      const row = new Container();
      row.position.set(0, y);
      const rowBackground = new Graphics()
        .roundRect(0, 0, availableWidth, 56, 9)
        .fill({
          color: hexToNum(selected ? colorValue : this.theme.appTheme.background),
          alpha: selected ? 0.12 : 0.55,
        })
        .stroke({
          color: hexToNum(selected ? colorValue : this.theme.appTheme.border),
          width: selected ? 2 : 1,
          alpha: selected ? 0.9 : 0.8,
        });
      const manaIcon = this.makeManaIcon(this.manaSymbol(color), 30);
      manaIcon.position.set(22, 28);
      const colorText = promptText(color, 13, this.theme.appTheme.foreground, { weight: "600" });
      colorText.position.set(44, 13);
      const stateText = promptText(
        selected ? `${count} selected` : "Not selected",
        10,
        selected ? colorValue : this.theme.appTheme["muted-foreground"],
        { weight: "600" },
      );
      stateText.position.set(44, 34);
      row.addChild(rowBackground, manaIcon, colorText, stateText);

      const controlX = availableWidth - 102;
      const minus = this.makeButton(
        "",
        () => {
          if (count <= 1) this.counts.delete(color);
          else this.counts.set(color, count - 1);
          this.rebuild();
        },
        {
          title: `Remove one ${color}`,
          icon: "lucide-minus",
          color: colorValue,
          outline: true,
          disabled: count <= 0,
          compact: true,
          width: 30,
          height: 34,
        },
      );
      minus.position.set(controlX, 11);
      const countBackground = new Graphics()
        .roundRect(controlX + 34, 11, 30, 34, 7)
        .fill({ color: hexToNum(this.theme.appTheme.muted), alpha: 0.55 });
      const countText = promptText(String(count), 14, this.theme.appTheme.foreground, {
        weight: "700",
      });
      countText.anchor.set(0.5);
      countText.position.set(controlX + 49, 28);
      const plus = this.makeButton(
        "",
        () => {
          this.counts.set(color, count + 1);
          this.rebuild();
        },
        {
          title: `Add one ${color}`,
          icon: "lucide-plus",
          color: colorValue,
          outline: true,
          disabled: total >= amount || (!repeatAllowed && count >= 1),
          compact: true,
          width: 30,
          height: 34,
        },
      );
      plus.position.set(controlX + 68, 11);
      row.addChild(minus, countBackground, countText, plus);
      body.addChild(row);
      y += 64;
    }

    const ready = total === amount;
    let previewX = 0;
    for (const [color, count] of this.counts) {
      if (typeof color !== "string" || count <= 0) continue;
      const icon = this.makeManaIcon(this.manaSymbol(color), 24);
      icon.position.set(previewX + 12, 18);
      footer.addChild(icon);
      previewX += 27;
      if (count > 1) {
        const countLabel = promptText(`×${count}`, 10, this.theme.appTheme.foreground, {
          weight: "700",
        });
        countLabel.position.set(previewX - 1, 11);
        footer.addChild(countLabel);
        previewX += countLabel.width + 8;
      }
    }
    const status = promptText(
      ready ? "Ready" : `${amount - total} left`,
      11,
      ready ? this.theme.gameTheme.success : this.theme.appTheme["muted-foreground"],
      { weight: "600" },
    );
    status.position.set(previewX + (previewX > 0 ? 4 : 0), 11);
    footer.addChild(status);
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
    confirm.position.set(availableWidth - confirm.buttonWidth, 0);
    footer.addChild(confirm);
  }

  private renderNumber(presentation: PromptPresentation, min: number, max: number): void {
    const range = max - min + 1;
    const width = Math.min(520, this.viewportWidth - 24);
    const height = Math.min(range <= 10 ? 250 : 275, this.viewportHeight - 24);
    const { body, footer } = this.createModalShell(
      width,
      height,
      presentation,
      true,
      false,
      range <= 10 ? 0 : 60,
    );
    const availableWidth = width - PANEL_PADDING * 2;
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
      this.addButtonRow(body, buttons, 20, availableWidth);
      return;
    }

    const parsedValue = Number(this.numberBuffer);
    const isValid =
      this.numberBuffer !== "" &&
      this.numberBuffer !== "-" &&
      Number.isInteger(parsedValue) &&
      parsedValue >= min &&
      parsedValue <= max;
    const setValue = (value: number) => {
      this.numberValue = Math.max(min, Math.min(max, value));
      this.numberBuffer = String(this.numberValue);
      this.rebuild();
    };
    const controlGap = 8;
    const edgeWidth = 58;
    const stepWidth = 46;
    const valueWidth = Math.max(
      104,
      availableWidth - edgeWidth * 2 - stepWidth * 2 - controlGap * 4,
    );
    let x = 0;
    const minimum = this.makeButton("MIN", () => setValue(min), {
      title: `Set to minimum ${min}`,
      outline: true,
      width: edgeWidth,
      height: 56,
    });
    minimum.position.set(x, 12);
    body.addChild(minimum);
    x += edgeWidth + controlGap;

    const decrease = this.makeButton("", () => setValue((isValid ? parsedValue : min) - 1), {
      title: "Decrease value",
      icon: "lucide-minus",
      iconSize: 20,
      outline: true,
      disabled: isValid && parsedValue <= min,
      width: stepWidth,
      height: 56,
    });
    decrease.position.set(x, 12);
    body.addChild(decrease);
    x += stepWidth + controlGap;

    const valueBackground = new Graphics()
      .roundRect(x, 12, valueWidth, 56, 9)
      .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.72 })
      .stroke({
        color: hexToNum(isValid ? this.theme.gameTheme.cardRing : this.theme.appTheme.destructive),
        width: 2,
        alpha: isValid ? 0.85 : 0.65,
      });
    valueBackground.eventMode = "static";
    valueBackground.cursor = "text";
    valueBackground.accessible = true;
    valueBackground.accessibleTitle = isValid
      ? `Current value ${parsedValue}. Type to replace or edit the value.`
      : `Enter a whole number from ${min} to ${max}.`;
    valueBackground.tabIndex = 0;
    const valueLabel = promptText("VALUE", 9, this.theme.appTheme["muted-foreground"], {
      weight: "700",
      letterSpacing: 0.8,
    });
    valueLabel.anchor.set(0.5, 0);
    valueLabel.position.set(x + valueWidth / 2, 17);
    const valueText = promptText(
      this.numberBuffer ? `${this.numberBuffer}│` : "Type…",
      this.numberBuffer ? 24 : 16,
      this.numberBuffer ? this.theme.appTheme.foreground : this.theme.appTheme["muted-foreground"],
      { weight: this.numberBuffer ? "700" : "500" },
    );
    valueText.anchor.set(0.5);
    valueText.position.set(x + valueWidth / 2, 44);
    body.addChild(valueBackground, valueLabel, valueText);
    x += valueWidth + controlGap;

    const increase = this.makeButton("", () => setValue((isValid ? parsedValue : min) + 1), {
      title: "Increase value",
      icon: "lucide-plus",
      iconSize: 20,
      outline: true,
      disabled: isValid && parsedValue >= max,
      width: stepWidth,
      height: 56,
    });
    increase.position.set(x, 12);
    body.addChild(increase);
    x += stepWidth + controlGap;

    const maximum = this.makeButton("MAX", () => setValue(max), {
      title: `Set to maximum ${max}`,
      outline: true,
      width: edgeWidth,
      height: 56,
    });
    maximum.position.set(x, 12);
    body.addChild(maximum);

    const rangeText = promptText(
      isValid ? `Whole number from ${min} to ${max}` : `Enter a whole number from ${min} to ${max}`,
      11,
      isValid ? this.theme.appTheme["muted-foreground"] : this.theme.appTheme.destructive,
      { weight: isValid ? "500" : "600", width: availableWidth - 140, truncate: true },
    );
    rangeText.position.set(0, 11);
    footer.addChild(rangeText);
    const confirm = this.makeButton(
      "CONFIRM",
      () => this.spec!.respond({ type: "numberDecision", chosenNumber: parsedValue }),
      { disabled: !isValid, width: 126 },
    );
    confirm.position.set(availableWidth - confirm.buttonWidth, 0);
    footer.addChild(confirm);
  }

  private renderReorder(presentation: PromptPresentation, items: ReorderItem[]): void {
    const width = Math.min(CARD_MODAL_MAX_WIDTH, this.viewportWidth - 24);
    const contentWidth = width - PANEL_PADDING * 2;
    const zoneWidth = contentWidth - CARD_TILE_EDGE_INSET * 2;
    const { width: preferredCardWidth } = this.promptCardDimensions();
    const denseCardWidth =
      items.length <= 1
        ? preferredCardWidth
        : (zoneWidth - REORDER_CARD_INSET * 2 - 12 * (items.length - 1)) / items.length;
    const cardWidth = Math.min(
      preferredCardWidth,
      zoneWidth - REORDER_CARD_INSET * 2,
      Math.max(112, denseCardWidth),
    );
    const cardHeight = cardWidth * CARD_ASPECT_RATIO;
    const hasSourceCard = !!(this.spec?.currentPrompt?.sourceCard ?? this.spec?.sourceDeckCard);
    const sourceIsInternal =
      hasSourceCard &&
      (this.viewportWidth - width) / 2 - SOURCE_CARD_GAP - 12 < SOURCE_CARD_EXTERNAL_WIDTH;
    const height = Math.min(
      this.viewportHeight - 24,
      cardHeight +
        REORDER_MODAL_VERTICAL_RESERVE +
        (sourceIsInternal ? preferredCardWidth * CARD_ASPECT_RATIO : 0),
    );
    const { body, footer } = this.createModalShell(width, height, presentation, true, false, 60);
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
        .fill(hexToNum(index === 0 ? this.theme.gameTheme.cardRing : this.theme.appTheme.muted));
      const rankText = promptText(
        String(index + 1),
        11,
        index === 0 ? this.theme.appTheme.background : this.theme.appTheme.foreground,
        { weight: "700" },
      );
      rankText.anchor.set(0.5);
      tile.addChild(rank, rankText);

      const move = (offset: number) => {
        const target = Math.max(0, Math.min(this.order.length - 1, index + offset));
        if (target === index) return;
        this.captureReorderCardPositions();
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
        backgroundColor: this.theme.gameTheme.cardRing,
        backgroundAlpha: 0.08,
        borderColor: this.theme.gameTheme.cardRing,
        borderAlpha: 0.42,
        hoverBackgroundAlpha: 0.24,
        hoverBorderAlpha: 1,
      });
      const next = this.makeButton("", () => move(1), {
        title: "Move later",
        icon: "lucide-chevron-right",
        outline: true,
        compact: true,
        disabled: index === this.order.length - 1,
        width: 32,
        backgroundColor: this.theme.gameTheme.cardRing,
        backgroundAlpha: 0.08,
        borderColor: this.theme.gameTheme.cardRing,
        borderAlpha: 0.42,
        hoverBackgroundAlpha: 0.24,
        hoverBorderAlpha: 1,
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
        rank,
        rankText,
        cardName: item.card.identity.name,
      });
    });

    const confirm = this.makeButton(
      "CONFIRM ORDER",
      () => this.spec!.respond({ type: "reorderDecision", orderedIds: [...this.order] }),
      { width: 150 },
    );
    confirm.position.set(contentWidth - confirm.buttonWidth, 0);
    footer.addChild(confirm);
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
      const first = previewIndex === 0;
      visual.rank
        .clear()
        .circle(0, 0, 13)
        .fill(hexToNum(first ? this.theme.gameTheme.cardRing : this.theme.appTheme.muted));
      visual.rankText.text = String(previewIndex + 1);
      visual.rankText.tint = hexToNum(
        first ? this.theme.appTheme.background : this.theme.appTheme.foreground,
      );
      visual.tile.accessibleTitle = `${visual.cardName}, position ${previewIndex + 1}`;
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

  private animateReorderLayout(): void {
    if (animationsEnabled()) {
      for (const [id, { tile, controls }] of this.reorderCardVisuals) {
        const previous = this.reorderPreviousPositions.get(id);
        if (!previous) continue;
        const start = tile.parent!.toLocal(previous);
        const x = tile.x;
        const y = tile.y;
        if (Math.hypot(x - start.x, y - start.y) < 0.5) continue;
        const controlX = controls.x;
        const controlY = controls.y;
        controls.position.set(controlX + start.x - x, controlY + start.y - y);
        tile.position.copyFrom(start);
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
    this.reorderPreviousPositions.clear();
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
    const poolWidth = width - PANEL_PADDING * 2;
    const zoneGap = 12;
    const zoneWidth = (poolWidth - zoneGap * (zones.length - 1)) / Math.max(1, zones.length);
    const preferredCardWidth = Math.min(180, this.promptCardDimensions().width);
    const cardWidth = Math.min(preferredCardWidth, Math.max(92, zoneWidth - 20));
    const cardHeight = cardWidth * CARD_ASPECT_RATIO;
    const stackDepth = Math.min(64, Math.max(0, cards.length - 1) * 16);
    const height = Math.min(
      this.viewportHeight - 24,
      Math.max(500, cardHeight * 2 + SCRY_BODY_VERTICAL_RESERVE + stackDepth),
    );
    const { body, footer } = this.createModalShell(width, height, presentation, true, false, 64);
    body.sortableChildren = true;
    const byId = new Map(cards.map((card) => [card.id, card]));
    const poolLabel = promptText("CARDS TO PLACE", 11, this.theme.appTheme["muted-foreground"], {
      weight: "700",
    });
    poolLabel.position.set(0, 2);
    body.addChild(poolLabel);
    const poolHeight = cardHeight + 20;
    const pool = new Rectangle(0, 24, poolWidth, poolHeight);
    const poolBg = new Graphics()
      .roundRect(pool.x, pool.y, pool.width, pool.height, 8)
      .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.6 })
      .stroke({ color: hexToNum(this.theme.appTheme["muted-foreground"]), width: 2, alpha: 0.45 });
    body.addChild(poolBg);
    const poolMarker = new Graphics()
      .roundRect(pool.x, pool.y, pool.width, pool.height, 8)
      .stroke({ color: hexToNum(this.theme.gameTheme.cardRing), width: 2.5 });
    poolMarker.eventMode = "none";
    poolMarker.visible = false;
    poolMarker.zIndex = 500;
    body.addChild(poolMarker);
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
      marker: poolMarker,
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

    const zoneY = pool.y + pool.height + 38;
    const zoneHeight = cardHeight + 20 + stackDepth;
    zones.forEach((destination, index) => {
      const key = `zone-${index}`;
      const ids = this.scryItems[key] ?? [];
      const rect = new Rectangle(index * (zoneWidth + zoneGap), zoneY, zoneWidth, zoneHeight);
      const zoneBg = new Graphics()
        .roundRect(rect.x, rect.y, rect.width, rect.height, 8)
        .fill({
          color: hexToNum(
            this.scrySelectedId ? this.theme.gameTheme.cardRing : this.theme.appTheme.background,
          ),
          alpha: this.scrySelectedId ? 0.08 : 0.45,
        })
        .stroke({
          color: hexToNum(
            this.scrySelectedId
              ? this.theme.gameTheme.cardRing
              : this.theme.appTheme["muted-foreground"],
          ),
          width: 2,
          alpha: this.scrySelectedId ? 0.75 : 0.45,
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
      const labelText = `${this.scryDestinationLabel(destination)}${ids.length ? ` · ${ids.length}` : ""}`;
      const label = promptText(
        labelText,
        11,
        this.scrySelectedId
          ? this.theme.gameTheme.cardRing
          : this.theme.appTheme["muted-foreground"],
        { weight: "700", width: zoneWidth - 8, truncate: true },
      );
      label.position.set(rect.x + 4, rect.y - 22);
      body.addChild(label);
      const dropX = rect.x + (rect.width - cardWidth) / 2;
      const dropY = rect.y + 10 + ids.length * 16;
      const marker = new Graphics()
        .roundRect(rect.x, rect.y, rect.width, rect.height, 8)
        .stroke({ color: hexToNum(this.theme.gameTheme.cardRing), width: 2.5 });
      marker.eventMode = "none";
      marker.visible = false;
      marker.zIndex = 500;
      body.addChild(marker);
      this.dropZones.push({
        id: key,
        rect,
        container: body,
        visual: zoneBg,
        dropX,
        dropY,
        targetAlpha: 1,
        marker,
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
        const tileY = rect.y + 10 + cardIndex * 16;
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
    const status = promptText(
      `${cards.length - poolIds.length} of ${cards.length} placed`,
      11,
      allPlaced ? this.theme.gameTheme.success : this.theme.appTheme["muted-foreground"],
      { weight: "600" },
    );
    status.position.set(0, 3);
    footer.addChild(status);
    const shortcuts = this.promptCardShortcutHint();
    if (shortcuts) {
      const shortcutText = promptText(shortcuts, 10, this.theme.appTheme["muted-foreground"]);
      shortcutText.position.set(0, 20);
      footer.addChild(shortcutText);
    }
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
    confirm.position.set(poolWidth - confirm.buttonWidth, 0);
    footer.addChild(confirm);
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
  }

  private animateScryLayout(): void {
    if (animationsEnabled()) {
      for (const [cardId, tile] of this.scryCardTiles) {
        const previous = this.scryPreviousPositions.get(cardId);
        if (!previous) continue;
        const start = tile.parent!.toLocal(previous);
        const x = tile.x;
        const y = tile.y;
        if (Math.hypot(x - start.x, y - start.y) < 0.5) continue;
        tile.position.copyFrom(start);
        gsap.to(tile.position, {
          x,
          y,
          duration: SCRY_LAYOUT_SETTLE_SECONDS,
          ease: "power3.out",
        });
      }
    }
    this.scryPreviousPositions.clear();
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
    const width = Math.min(540, this.viewportWidth - 24);
    const height = Math.min(this.viewportHeight - 24, 270 + damageOrder.blockerCards.length * 72);
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
      description: `${damageOrder.attackerName} is blocked by ${damageOrder.blockerCards.length} creatures. Choose which blocker receives damage first.`,
      targets,
    };
    const { body, footer } = this.createModalShell(width, height, presentation, true, true, 60);
    const availableWidth = width - PANEL_PADDING * 2;
    const selectedCount = damageOrder.order.length;
    const complete =
      selectedCount >= damageOrder.blockerCards.length && damageOrder.blockerCards.length > 0;
    const progressBackground = new Graphics()
      .roundRect(0, 4, availableWidth, 36, 8)
      .fill({
        color: hexToNum(complete ? this.theme.gameTheme.success : this.theme.appTheme.background),
        alpha: complete ? 0.12 : 0.6,
      })
      .stroke({
        color: hexToNum(complete ? this.theme.gameTheme.success : this.theme.appTheme.border),
        width: 1,
        alpha: 0.8,
      });
    const progressText = promptText(
      complete
        ? "Order complete"
        : selectedCount === 0
          ? "Choose the first blocker"
          : `Choose blocker ${selectedCount + 1} of ${damageOrder.blockerCards.length}`,
      12,
      complete ? this.theme.gameTheme.success : this.theme.appTheme.foreground,
      { weight: "600" },
    );
    progressText.position.set(12, 14);
    const progressCount = promptText(
      `${selectedCount}/${damageOrder.blockerCards.length}`,
      12,
      complete ? this.theme.gameTheme.success : this.theme.appTheme["muted-foreground"],
      { weight: "700" },
    );
    progressCount.anchor.set(1, 0);
    progressCount.position.set(availableWidth - 12, 14);
    body.addChild(progressBackground, progressText, progressCount);

    let y = 52;
    for (const card of damageOrder.blockerCards) {
      const index = damageOrder.order.indexOf(card.id);
      const selected = index >= 0;
      const row = new Container();
      row.position.set(0, y);
      row.eventMode = "static";
      row.cursor = "pointer";
      row.hitArea = new Rectangle(0, 0, availableWidth, 62);
      row.accessible = true;
      row.accessibleTitle = selected
        ? `${card.identity.name}, damage order ${index + 1}, ${card.power ?? "unknown"} power and ${card.toughness ?? "unknown"} toughness`
        : `${card.identity.name}, not ordered, ${card.power ?? "unknown"} power and ${card.toughness ?? "unknown"} toughness`;
      row.accessibleHint = "Activate to add or remove this blocker from the damage order.";
      row.tabIndex = 0;
      const background = new Graphics()
        .roundRect(0, 0, availableWidth, 62, 8)
        .fill({
          color: hexToNum(
            selected ? this.theme.gameTheme.cardRing : this.theme.appTheme.background,
          ),
          alpha: selected ? 0.11 : 0.58,
        })
        .stroke({
          color: hexToNum(selected ? this.theme.gameTheme.cardRing : this.theme.appTheme.border),
          width: selected ? 2 : 1,
          alpha: selected ? 0.9 : 0.8,
        });
      const rankBackground = new Graphics().circle(25, 31, 14).fill({
        color: hexToNum(selected ? this.theme.gameTheme.cardRing : this.theme.appTheme.muted),
        alpha: selected ? 1 : 0.72,
      });
      const rank = promptText(
        selected ? String(index + 1) : "—",
        14,
        this.theme.appTheme.foreground,
        {
          weight: "700",
        },
      );
      rank.anchor.set(0.5);
      rank.position.set(25, 31);
      const label = promptText(card.identity.name, 13, this.theme.appTheme.foreground, {
        weight: "600",
        width: availableWidth - 132,
        truncate: true,
      });
      label.position.set(50, 12);
      const stats = promptText(
        `${card.power ?? "?"}/${card.toughness ?? "?"}${card.damage ? ` · ${card.damage} damage marked` : ""}`,
        10,
        this.theme.appTheme["muted-foreground"],
        { weight: "600" },
      );
      stats.position.set(50, 36);
      const state = promptText(
        selected ? `ORDER ${index + 1}` : "SELECT",
        10,
        selected ? this.theme.gameTheme.cardRing : this.theme.appTheme["muted-foreground"],
        { weight: "700", letterSpacing: 0.7 },
      );
      state.anchor.set(1, 0.5);
      state.position.set(availableWidth - 14, 31);
      row.addChild(background, rankBackground, rank, label, stats, state);
      const target: TargetRef = { kind: "card", id: card.id, intent: "damage" };
      row.on("pointerover", () => this.callbacks.onReferenceChange?.(target));
      row.on("pointerout", () => this.callbacks.onReferenceChange?.(null));
      row.on("focusin", () => this.callbacks.onReferenceChange?.(target));
      row.on("focusout", () => this.callbacks.onReferenceChange?.(null));
      row.on("pointertap", () => damageOrder.onToggle(card.id));
      body.addChild(row);
      y += 70;
    }

    const auto = this.makeButton("AUTO", damageOrder.onAuto, {
      outline: true,
      disabled: this.spec!.action.isWaitingForResponse,
    });
    auto.position.set(0, 0);
    footer.addChild(auto);
    if (selectedCount > 0) {
      const undo = this.makeButton("UNDO", damageOrder.onUndo, {
        outline: true,
        disabled: this.spec!.action.isWaitingForResponse,
      });
      undo.position.set(auto.buttonWidth + 8, 0);
      footer.addChild(undo);
    }
    const confirm = this.makeButton("CONFIRM ORDER", damageOrder.onConfirm, {
      disabled: this.spec!.action.isWaitingForResponse || !complete,
      icon: "lucide-swords",
      width: 156,
    });
    confirm.position.set(availableWidth - confirm.buttonWidth, 0);
    footer.addChild(confirm);
  }

  private renderCombatDamage(input: ChooseCombatDamageAssignmentInput): void {
    const width = Math.min(600, this.viewportWidth - 24);
    const availableWidth = width - PANEL_PADDING * 2;
    const assignees = [...input.blockerIds, ...(input.defenderId ? [input.defenderId] : [])];
    const height = Math.min(this.viewportHeight - 24, 330 + assignees.length * 74);
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
        ? `${attacker.identity.name} assigns ${input.totalDamage} combat damage.`
        : undefined,
      targets,
    };
    const { body, footer } = this.createModalShell(width, height, presentation, true, true, 60);
    const assigned = Object.values(this.damageAssigned).reduce((sum, damage) => sum + damage, 0);
    const remaining = input.totalDamage - assigned;
    const metricWidth = (availableWidth - 16) / 3;
    const metrics: Array<{ label: string; value: number; color: string }> = [
      { label: "TOTAL", value: input.totalDamage, color: this.theme.appTheme.foreground },
      { label: "ASSIGNED", value: assigned, color: this.theme.gameTheme.cardRing },
      {
        label: "REMAINING",
        value: remaining,
        color: remaining === 0 ? this.theme.gameTheme.success : this.theme.appTheme.foreground,
      },
    ];
    metrics.forEach((metric, index) => {
      const x = index * (metricWidth + 8);
      const background = new Graphics()
        .roundRect(x, 4, metricWidth, 48, 8)
        .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.62 })
        .stroke({ color: hexToNum(metric.color), width: 1, alpha: 0.55 });
      const value = promptText(String(metric.value), 18, metric.color, { weight: "700" });
      value.anchor.set(0.5);
      value.position.set(x + metricWidth / 2, 21);
      const label = promptText(metric.label, 9, this.theme.appTheme["muted-foreground"], {
        weight: "700",
        letterSpacing: 0.7,
      });
      label.anchor.set(0.5);
      label.position.set(x + metricWidth / 2, 40);
      body.addChild(background, value, label);
    });

    const targetHeader = promptText("TARGET", 9, this.theme.appTheme["muted-foreground"], {
      weight: "700",
      letterSpacing: 0.7,
    });
    targetHeader.position.set(10, 66);
    const lethalHeader = promptText("LETHAL", 9, this.theme.appTheme["muted-foreground"], {
      weight: "700",
      letterSpacing: 0.7,
    });
    lethalHeader.anchor.set(0.5, 0);
    lethalHeader.position.set(availableWidth - 150, 66);
    const assignedHeader = promptText("ASSIGNED", 9, this.theme.appTheme["muted-foreground"], {
      weight: "700",
      letterSpacing: 0.7,
    });
    assignedHeader.anchor.set(0.5, 0);
    assignedHeader.position.set(availableWidth - 52, 66);
    body.addChild(targetHeader, lethalHeader, assignedHeader);

    let y = 82;
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
      const lethalReached = lethal != null && damage >= lethal;
      const rowBg = new Graphics()
        .roundRect(0, y, availableWidth, 62, 7)
        .fill({
          color: hexToNum(
            lethalReached
              ? this.theme.gameTheme.promptAction.attackAction
              : this.theme.appTheme.background,
          ),
          alpha: lethalReached ? 0.1 : 0.55,
        })
        .stroke({
          color: hexToNum(
            lethalReached
              ? this.theme.gameTheme.promptAction.attackAction
              : this.theme.appTheme.border,
          ),
          width: lethalReached ? 2 : 1,
          alpha: lethalReached ? 0.8 : 1,
        });
      rowBg.eventMode = "static";
      rowBg.cursor = "default";
      rowBg.accessible = true;
      rowBg.accessibleTitle = `Damage assigned to ${label}: ${damage}${
        lethal == null ? "" : `, lethal damage ${lethal}`
      }${blocked ? ", unavailable until the previous target has lethal damage" : ""}`;
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
      const card = this.spec!.gameView.battlefield.find((candidate) => candidate.id === id);
      const name = promptText(label, 12, this.theme.appTheme.foreground, {
        weight: "600",
        width: availableWidth - 226,
        truncate: true,
      });
      name.position.set(10, y + 10);
      const detail = blocked
        ? "Assign lethal to the previous target first"
        : defender
          ? `${defender.life} → ${defender.life - damage} life`
          : `${card?.power ?? "?"}/${card?.toughness ?? "?"}${card?.damage ? ` · ${card.damage} marked` : ""}`;
      const detailText = promptText(
        detail,
        10,
        blocked
          ? this.theme.gameTheme.promptAction.attackAction
          : this.theme.appTheme["muted-foreground"],
        { weight: blocked ? "600" : "500", width: availableWidth - 226, truncate: true },
      );
      detailText.position.set(10, y + 36);
      body.addChild(name, detailText);

      if (lethal != null) {
        const lethalButton = this.makeButton(
          lethalReached ? `${lethal} ✓` : String(lethal),
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
            disabled: blocked || lethalReached || remaining <= 0,
            compact: true,
            width: 58,
            height: 36,
          },
        );
        lethalButton.position.set(availableWidth - 180, y + 13);
        body.addChild(lethalButton);
      } else {
        const dash = promptText("—", 14, this.theme.appTheme["muted-foreground"]);
        dash.anchor.set(0.5);
        dash.position.set(availableWidth - 150, y + 31);
        body.addChild(dash);
      }

      const minus = this.makeButton(
        "",
        () => {
          this.damageAssigned[id] = Math.max(0, damage - 1);
          this.normalizeDamage(input, assignees);
          this.rebuild();
        },
        {
          title: `Remove one damage from ${label}`,
          icon: "lucide-minus",
          outline: true,
          disabled: damage <= 0,
          compact: true,
          width: 32,
          height: 36,
        },
      );
      const amountBackground = new Graphics()
        .roundRect(availableWidth - 106, y + 13, 34, 36, 7)
        .fill({ color: hexToNum(this.theme.appTheme.muted), alpha: 0.55 });
      const amount = promptText(String(damage), 14, this.theme.appTheme.foreground, {
        weight: "700",
      });
      amount.anchor.set(0.5);
      const plus = this.makeButton(
        "",
        () => {
          this.damageAssigned[id] = damage + 1;
          this.normalizeDamage(input, assignees);
          this.rebuild();
        },
        {
          title: `Assign one damage to ${label}`,
          icon: "lucide-plus",
          outline: true,
          disabled: blocked || remaining <= 0,
          compact: true,
          width: 32,
          height: 36,
        },
      );
      minus.position.set(availableWidth - 142, y + 13);
      amount.position.set(availableWidth - 89, y + 31);
      plus.position.set(availableWidth - 68, y + 13);
      body.addChild(minus, amountBackground, amount, plus);
      y += 70;
    });

    const legal = remaining === 0 && this.damageLegallyOrdered(input, assignees);
    const reset = this.makeButton(
      "RESET",
      () => {
        this.damageAssigned = {};
        this.rebuild();
      },
      { outline: true },
    );
    reset.position.set(0, 0);
    const auto = this.makeButton(
      "AUTO",
      () => {
        this.autoAssignDamage(input, assignees);
        this.rebuild();
      },
      { outline: true },
    );
    auto.position.set(reset.buttonWidth + 8, 0);
    const confirm = this.makeButton(
      "CONFIRM",
      () =>
        this.spec!.respond({
          type: "combatDamageAssignmentDecision",
          assignments: assignees.map((assigneeId) => ({
            assigneeId,
            damage: this.damageAssigned[assigneeId] ?? 0,
          })),
        }),
      { disabled: !legal, width: 126 },
    );
    confirm.position.set(availableWidth - confirm.buttonWidth, 0);
    footer.addChild(reset, auto, confirm);
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

  private renderDice(
    presentation: PromptPresentation,
    sides: number,
    rolls: Array<{
      label?: string;
      playerId?: string;
      round?: number;
      naturalResults: number[];
      finalResults: number[];
      ignoredRolls: number[];
      highlighted: boolean;
    }>,
  ): void {
    const maxRound = Math.max(0, ...rolls.map((roll) => roll.round ?? 0));
    const entries: RollDisplayEntry[] = rolls.flatMap((roll, rollIndex) => {
      const round = roll.round ?? 0;
      const label =
        maxRound > 0 ? `Round ${round + 1} · ${roll.label ?? `Roll ${rollIndex + 1}`}` : roll.label;
      const kept = roll.finalResults.map((value, resultIndex) => {
        const natural = roll.naturalResults[resultIndex] ?? value;
        return {
          kind: "die" as const,
          sides,
          value,
          playerId: roll.playerId,
          label:
            roll.finalResults.length > 1
              ? `${label ?? `Roll ${rollIndex + 1}`} ${resultIndex + 1}`
              : label,
          detail: natural === value ? undefined : `${natural} → ${value}`,
          round,
          highlighted: roll.highlighted,
          ignored: false,
        };
      });
      return [
        ...kept,
        ...roll.ignoredRolls.map((value, ignoredIndex) => ({
          kind: "die" as const,
          sides,
          value,
          playerId: roll.playerId,
          label: `${label ?? `Roll ${rollIndex + 1}`} ignored ${ignoredIndex + 1}`,
          round,
          highlighted: false,
          ignored: true,
        })),
      ];
    });
    this.renderRollResults(
      { ...presentation, title: `${presentation.title || "Dice roll"} · d${sides}` },
      entries,
      "Dice roll",
      () => this.spec!.respond({ type: "diceRolledAcknowledged" }),
    );
  }

  private renderCoin(
    presentation: PromptPresentation,
    flips: Array<{
      label?: string;
      playerId?: string;
      results: Array<"heads" | "tails">;
      keptResult: "heads" | "tails";
      calledFace?: "heads" | "tails";
      won?: boolean;
    }>,
  ): void {
    const entries = flips.flatMap((flip, flipIndex) => {
      let kept = false;
      return flip.results.map((value, resultIndex): RollDisplayEntry => {
        const isKept = !kept && value === flip.keptResult;
        kept ||= isKept;
        const call = flip.calledFace ? `Called ${flip.calledFace}` : undefined;
        const outcome = flip.won == null ? undefined : flip.won ? "Won" : "Lost";
        return {
          kind: "coin",
          sides: 2,
          value,
          playerId: flip.playerId,
          label:
            flip.results.length > 1
              ? `${flip.label ?? `Flip ${flipIndex + 1}`} ${resultIndex + 1}`
              : flip.label,
          detail: [call, outcome].filter(Boolean).join(" · ") || undefined,
          round: 0,
          highlighted: flip.won === true && isKept,
          ignored: !isKept,
        };
      });
    });
    this.renderRollResults(presentation, entries, "Coin flip", () =>
      this.spec!.respond({ type: "coinFlippedAcknowledged" }),
    );
  }

  private renderPlanarDie(
    presentation: PromptPresentation,
    rolls: Array<{
      label?: string;
      playerId?: string;
      results: Array<"planeswalk" | "chaos" | "blank">;
      ignoredResults: Array<"planeswalk" | "chaos" | "blank">;
    }>,
  ): void {
    const entries: RollDisplayEntry[] = rolls.flatMap((roll, rollIndex) => [
      ...roll.results.map((value, index) => ({
        kind: "planar" as const,
        sides: 3,
        value,
        playerId: roll.playerId,
        label:
          roll.results.length > 1
            ? `${roll.label ?? `Planar roll ${rollIndex + 1}`} ${index + 1}`
            : roll.label,
        detail:
          value === "planeswalk" ? "Planeswalk" : value === "chaos" ? "Chaos ensues" : "Blank",
        round: 0,
        highlighted: value !== "blank",
        ignored: false,
      })),
      ...roll.ignoredResults.map((value, index) => ({
        kind: "planar" as const,
        sides: 3,
        value,
        playerId: roll.playerId,
        label: `${roll.label ?? `Planar roll ${rollIndex + 1}`} ignored ${index + 1}`,
        round: 0,
        highlighted: false,
        ignored: true,
      })),
    ]);
    this.renderRollResults(presentation, entries, "Planar die roll", () =>
      this.spec!.respond({ type: "planarDieRolledAcknowledged" }),
    );
  }

  private renderRollResults(
    presentation: PromptPresentation,
    entries: RollDisplayEntry[],
    fallbackTitle: string,
    onConfirm: () => void,
  ): void {
    this.rollVisuals = [];
    this.rollHighlightText = null;
    this.rollHighlightLabel = null;
    this.rollConfirm = null;
    const visibleEntries = entries.length
      ? entries
      : [
          {
            kind: "die" as const,
            sides: 6,
            value: "—",
            round: 0,
            highlighted: false,
            ignored: false,
          },
        ];
    const maxRound = Math.max(0, ...visibleEntries.map((entry) => entry.round));
    this.rollDurationMs = rollDuration(visibleEntries.length, maxRound);
    this.rollSettled = !animationsEnabled() || this.rollElapsedMs >= this.rollDurationMs;
    const width = Math.min(620, this.viewportWidth - 24);
    const landingColumns = Math.max(1, Math.ceil(Math.sqrt(visibleEntries.length)));
    const landingRows = Math.max(1, Math.ceil(visibleEntries.length / landingColumns));
    const dieSize = Math.min(
      72,
      (width - PANEL_PADDING * 2 - ROW_GAP * (landingColumns - 1)) / landingColumns,
    );
    const winner = visibleEntries.find((entry) => entry.highlighted && !entry.ignored);
    const height = Math.min(620, this.viewportHeight - 24);
    const footerHeight = 60;
    const title = presentation.title || fallbackTitle;
    const { panel, body, bodyTop, footer } = this.createModalShell(
      width,
      height,
      { ...presentation, title },
      true,
      false,
      footerHeight,
    );
    const availableWidth = width - PANEL_PADDING * 2;
    const bodyHeight = Math.max(0, height - bodyTop - footerHeight - MODAL_BODY_BOTTOM_PADDING);
    const resultBottom = winner ? Math.max(0, bodyHeight - 58) : bodyHeight;
    const throwBottom = winner ? resultBottom - 12 : bodyHeight - 12;
    const arenaTop = 8;
    const arenaHeight = Math.max(dieSize + 32, throwBottom - arenaTop);
    const cellWidth = availableWidth / landingColumns;
    const cellHeight = arenaHeight / landingRows;
    const layoutSeed = rollSeed(
      this.spec?.currentPrompt?.promptId,
      maxRound,
      visibleEntries.length,
    );
    const landingSlots = visibleEntries
      .map((_, index) => index)
      .sort(
        (left, right) => rollRandom(layoutSeed, left + 110) - rollRandom(layoutSeed, right + 110),
      );
    body.boundsArea = new Rectangle(0, 0, availableWidth, bodyHeight);
    const rollLayer = new Container();
    rollLayer.position.set(PANEL_PADDING, bodyTop);
    panel.addChildAt(rollLayer, panel.getChildIndex(body) + 1);
    body.accessible = true;
    body.accessibleTitle = visibleEntries
      .map(
        (entry) =>
          `${entry.label ? `${entry.label}: ` : ""}${entry.value}${entry.ignored ? ", ignored" : ""}`,
      )
      .join(". ");
    const particleLayer = animationsEnabled()
      ? new ParticleContainer<Particle>({
          texture: Texture.WHITE,
          boundsArea: new Rectangle(0, -120, availableWidth, bodyHeight + 240),
          blendMode: "add",
          dynamicProperties: {
            position: true,
            rotation: true,
            vertex: true,
            color: true,
          },
        })
      : null;
    if (particleLayer) {
      particleLayer.eventMode = "none";
      rollLayer.addChild(particleLayer);
    }
    visibleEntries.forEach((entry, index) => {
      const slot = landingSlots[index] ?? index;
      const column = slot % landingColumns;
      const row = Math.floor(slot / landingColumns);
      const seed = rollSeed(this.spec?.currentPrompt?.promptId, entry.round, index);
      const horizontalSlack = Math.max(0, cellWidth - dieSize - 24);
      const verticalSlack = Math.max(0, cellHeight - dieSize - 28);
      const slotX = (column + 0.5) * cellWidth;
      const slotY = arenaTop + (row + 0.5) * cellHeight;
      const x = Math.max(
        dieSize / 2 + 8,
        Math.min(
          availableWidth - dieSize / 2 - 8,
          slotX + (rollRandom(seed, 90) - 0.5) * horizontalSlack * 0.8,
        ),
      );
      const y = Math.max(
        dieSize / 2 + 8,
        Math.min(
          throwBottom - dieSize / 2 - 24,
          slotY + (rollRandom(seed, 91) - 0.5) * verticalSlack * 0.8,
        ),
      );
      const playerColor = this.rollPlayerColor(entry.playerId);
      const playerTint = hexToNum(playerColor);
      const foreground = readableTextColor(
        playerColor,
        this.theme.gameTheme.canvas.shadow,
        this.theme.gameTheme.textOnTinted,
      );
      const aura = new Graphics()
        .circle(0, 0, dieSize * 0.64)
        .stroke({ color: playerTint, width: 5, alpha: 0.16 })
        .star(0, 0, 8, dieSize * 0.61, dieSize * 0.56, Math.PI / 8)
        .stroke({ color: playerTint, width: 1.5, alpha: 0.76 });
      aura.position.set(x, y);
      aura.alpha = this.rollSettled ? (entry.highlighted ? 0.46 : entry.ignored ? 0 : 0.12) : 0;
      aura.eventMode = "none";
      const token = createRollToken({
        kind: entry.kind,
        sides: entry.sides,
        size: dieSize,
        fill: playerColor,
        border: entry.ignored ? this.theme.appTheme.destructive : darken(playerColor, 0.28),
        foreground,
        shadow: this.theme.gameTheme.canvas.shadow,
      });
      token.root.position.set(x, y);
      setRollTokenValue(token, entry.value);
      rollLayer.addChild(aura, token.root);
      const ignoredMark = entry.ignored
        ? new Graphics()
            .moveTo(-dieSize * 0.42, dieSize * 0.42)
            .lineTo(dieSize * 0.42, -dieSize * 0.42)
            .stroke({ color: hexToNum(this.theme.appTheme.destructive), width: 3, alpha: 0.9 })
        : null;
      if (ignoredMark) {
        ignoredMark.alpha = this.rollSettled ? 1 : 0;
        token.root.addChild(ignoredMark);
      }
      this.rollVisuals.push({
        token,
        finalValue: entry.value,
        index,
        sides: entry.sides,
        round: entry.round,
        seed,
        baseX: x,
        baseY: y,
        startX: dieSize / 2 + 8 + rollRandom(seed, 93) * Math.max(0, availableWidth - dieSize - 16),
        startY: -bodyTop - dieSize * (0.55 + rollRandom(seed, 94) * 0.75),
        restingRotation: (rollRandom(seed, 92) - 0.5) * 0.28,
        ignored: entry.ignored,
        ignoredMark,
        aura,
        highlighted: entry.highlighted,
        playerColor: playerTint,
      });
      if (entry.label || entry.detail) {
        const label = promptText(
          [entry.label, entry.detail].filter(Boolean).join(" · "),
          10,
          this.theme.appTheme["muted-foreground"],
          { weight: "600", width: dieSize + ROW_GAP, align: "center" },
        );
        label.anchor.set(0.5, 0);
        label.position.set(x, y + dieSize / 2 + 5);
        body.addChild(label);
      }
    });
    if (winner) {
      const winnerLabel = winner.label ?? String(winner.value);
      const winnerColor = this.rollPlayerColor(winner.playerId);
      const winnerTint = hexToNum(winnerColor);
      const resultBackground = new Graphics()
        .roundRect(0, resultBottom, width - PANEL_PADDING * 2, 46, 8)
        .fill({ color: winnerTint, alpha: 0.16 })
        .stroke({ color: winnerTint, width: 1, alpha: 0.82 });
      const resultLabel = promptText("RESULT", 9, winnerColor, {
        weight: "700",
        letterSpacing: 0.8,
      });
      resultLabel.anchor.set(0.5, 0);
      resultLabel.position.set((width - PANEL_PADDING * 2) / 2, resultBottom + 6);
      const winnerText = promptText(
        this.rollSettled ? winnerLabel : "Rolling…",
        16,
        this.theme.appTheme.foreground,
        { weight: "700" },
      );
      winnerText.anchor.set(0.5, 0);
      winnerText.position.set((width - PANEL_PADDING * 2) / 2, resultBottom + 21);
      this.rollHighlightText = winnerText;
      this.rollHighlightLabel = winnerLabel;
      body.addChild(resultBackground, resultLabel, winnerText);
    }
    const confirm = this.makeButton("CONTINUE", onConfirm, {
      disabled: !this.rollSettled,
      width: 120,
    });
    this.rollConfirm = confirm;
    confirm.position.set(width - PANEL_PADDING * 2 - confirm.buttonWidth, 0);
    footer.addChild(confirm);
    this.startRollAnimation(particleLayer);
  }

  private rollPlayerColor(playerId: string | undefined): string {
    const colors = this.theme.gameTheme.playerColors;
    if (!playerId || playerId === this.spec?.localPlayerId) return colors.self;
    const opponentIndex = this.spec
      ? this.spec.gameView.players
          .filter((player) => player.id !== this.spec!.localPlayerId)
          .findIndex((player) => player.id === playerId)
      : 0;
    const seat = OPPONENT_SEATS[Math.max(0, Math.min(OPPONENT_SEATS.length - 1, opponentIndex))]!;
    return colors[seat];
  }

  private startRollAnimation(particleLayer: ParticleContainer<Particle> | null): void {
    if (!animationsEnabled() || this.rollSettled) {
      this.settleRollVisuals();
      return;
    }
    const timeline = gsap.timeline({ paused: true });
    this.rollTimeline = timeline;
    for (const visual of this.rollVisuals) {
      const delay = rollDelayMs(visual.index, visual.round) / 1000;
      const trajectory = rollTrajectory(visual.seed);
      const finalRotation =
        trajectory.direction * Math.round(trajectory.turns) * Math.PI * 2 + visual.restingRotation;
      const startX = visual.startX + trajectory.startX;
      const startY = visual.startY + trajectory.startY;
      const controlX = (startX + visual.baseX) / 2 + trajectory.controlX;
      const controlY = Math.min(
        visual.baseY - 54,
        startY + (visual.baseY - startY) * 0.38 + trajectory.controlY,
      );
      visual.token.root.position.set(startX, startY);
      visual.token.root.alpha = 0;
      visual.token.root.rotation = -trajectory.direction * 0.8;
      visual.token.root.scale.set(0.48);
      const landingAt = delay + ROLL_FLIGHT_MS / 1000;
      timeline.to(
        visual.token.root,
        {
          alpha: 1,
          duration: 0.12,
          ease: "power2.out",
        },
        delay,
      );
      timeline.to(
        visual.token.root,
        {
          rotation: finalRotation - trajectory.direction * 0.18,
          pixi: { scaleX: 1.08, scaleY: 0.92 },
          motionPath: {
            path: [
              { x: startX, y: startY },
              {
                x: controlX,
                y: controlY,
              },
              { x: visual.baseX, y: visual.baseY },
            ],
            curviness: 1.25,
          },
          duration: ROLL_FLIGHT_MS / 1000,
          ease: "power2.inOut",
        },
        delay,
      );
      timeline.to(
        visual.token.root,
        {
          y: visual.baseY - 11,
          rotation: finalRotation + trajectory.direction * 0.1,
          pixi: { scaleX: 1.14, scaleY: 0.84 },
          duration: ROLL_IMPACT_MS / 1000,
          ease: "power2.out",
        },
        landingAt,
      );
      timeline.to(
        visual.token.root,
        {
          x: visual.baseX,
          y: visual.baseY,
          rotation: finalRotation,
          pixi: { scaleX: 1, scaleY: 1 },
          duration: ROLL_SETTLE_MS / 1000,
          ease: "elastic.out(1, 0.42)",
        },
        landingAt + ROLL_IMPACT_MS / 1000,
      );
      timeline.fromTo(
        visual.aura,
        { alpha: 0, rotation: -trajectory.direction * 0.25, pixi: { scale: 0.24 } },
        {
          alpha: visual.highlighted ? 0.82 : visual.ignored ? 0.36 : 0.58,
          rotation: trajectory.direction * 0.16,
          pixi: { scale: 1.24 },
          duration: 0.28,
          ease: "power3.out",
        },
        landingAt - 0.04,
      );
      timeline.to(
        visual.aura,
        {
          alpha: visual.highlighted ? 0.46 : visual.ignored ? 0 : 0.12,
          rotation: 0,
          pixi: { scale: 1 },
          duration: 0.42,
          ease: "power2.out",
        },
        landingAt + 0.24,
      );
      timeline.fromTo(
        visual.token.glint,
        { alpha: 0 },
        { alpha: 0.9, duration: 0.12, repeat: 1, yoyo: true, ease: "power2.out" },
        landingAt + 0.06,
      );
      if (particleLayer) {
        for (let index = 0; index < 10; index += 1) {
          const burst = rollBurst(visual.seed, index);
          const particle = new Particle({
            texture: Texture.WHITE,
            x: visual.baseX,
            y: visual.baseY,
            anchorX: 0.5,
            anchorY: 0.5,
            scaleX: burst.length * 0.52,
            scaleY: burst.length * 2.2,
            rotation: burst.angle,
            tint: visual.playerColor,
            alpha: 0,
          });
          particleLayer.addParticle(particle);
          const burstAt = landingAt + burst.delay;
          timeline.set(
            particle,
            {
              x: visual.baseX,
              y: visual.baseY,
              alpha: 0.94,
              rotation: burst.angle,
            },
            burstAt,
          );
          timeline.to(
            particle,
            {
              x: visual.baseX + Math.cos(burst.angle) * burst.distance,
              y: visual.baseY + Math.sin(burst.angle) * burst.distance,
              alpha: 0,
              rotation: burst.angle + trajectory.direction * 0.7,
              scaleX: 0.01,
              scaleY: burst.length * 0.4,
              duration: 0.52,
              ease: "power2.out",
            },
            burstAt,
          );
        }
      }
    }
    particleLayer?.update();
    timeline.eventCallback("onComplete", () => {
      if (this.rollTimeline !== timeline) return;
      this.rollTimeline = null;
      this.rollElapsedMs = this.rollDurationMs;
      this.settleRollVisuals();
    });
    timeline.seek(Math.min(this.rollElapsedMs / 1000, timeline.duration()), true);
    timeline.play();
    this.syncRollVisuals();
  }

  private settleRollVisuals(): void {
    this.rollSettled = true;
    for (const visual of this.rollVisuals) {
      visual.token.root.position.set(
        visual.baseX + (visual.ignored ? 10 : 0),
        visual.baseY + (visual.ignored ? 6 : 0),
      );
      visual.token.root.rotation = visual.restingRotation;
      visual.token.root.scale.set(1);
      visual.token.root.alpha = visual.ignored ? 0.42 : 1;
      visual.token.glint.alpha = 0;
      visual.aura.position.set(visual.baseX, visual.baseY);
      visual.aura.rotation = 0;
      visual.aura.scale.set(1);
      visual.aura.alpha = visual.highlighted ? 0.46 : visual.ignored ? 0 : 0.12;
      if (visual.ignoredMark) visual.ignoredMark.alpha = 1;
      setRollTokenValue(visual.token, visual.finalValue);
    }
    if (this.rollHighlightText && this.rollHighlightLabel) {
      this.rollHighlightText.text = this.rollHighlightLabel;
    }
    this.rollConfirm?.setDisabled(false);
    if (animationsEnabled() && this.rollHighlightText) {
      gsap.fromTo(
        this.rollHighlightText,
        { alpha: 0.55 },
        { alpha: 1, duration: 0.22, ease: "power2.out" },
      );
    }
  }

  private stopRollAnimation(): void {
    this.rollTimeline?.kill();
    this.rollTimeline = null;
  }

  private renderGameOver(): void {
    const gameOver = this.spec!.gameOver!;
    const players = [gameOver.me, ...gameOver.opponents];
    const anyConceded = players.some((player) => player.status === "conceded");
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
    const winner = players.find((player) => player.id === gameOver.winnerId);
    const summary = winner
      ? `${winner.name} won on turn ${gameOver.turn}`
      : `Game ended in a draw on turn ${gameOver.turn}`;
    const backdrop = new Graphics()
      .rect(0, 0, this.viewportWidth, this.viewportHeight)
      .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.72 });
    backdrop.eventMode = "static";
    this.container.addChild(backdrop);
    const panelWidth = Math.min(520, this.viewportWidth - 24);
    const panelHeight = Math.min(this.viewportHeight - 24, 206 + players.length * 36);
    const group = this.panel(panelWidth, panelHeight, 0, 0, 12);
    group.accessible = true;
    group.accessibleTitle = `Game over: ${heading}. ${summary}`;
    group.tabIndex = 0;
    const accent = new Graphics()
      .roundRect(0, 0, panelWidth, 4, 12)
      .fill({ color: hexToNum(color) });
    group.addChild(accent);
    const title = promptText(heading, 34, color, { weight: "700" });
    title.anchor.set(0.5);
    title.position.set(panelWidth / 2, 48);
    group.addChild(title);
    const summaryText = promptText(summary, 12, this.theme.appTheme["muted-foreground"], {
      align: "center",
      width: panelWidth - 40,
      weight: "600",
    });
    summaryText.anchor.set(0.5, 0);
    summaryText.position.set(panelWidth / 2, 76);
    group.addChild(summaryText);

    let rowY = 106;
    for (const player of players) {
      const isWinner = player.id === gameOver.winnerId;
      const rowColor = isWinner
        ? this.theme.gameTheme.success
        : player.status === "conceded"
          ? this.theme.appTheme.destructive
          : this.theme.appTheme.border;
      const row = new Graphics()
        .roundRect(20, rowY, panelWidth - 40, 30, 7)
        .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.5 })
        .stroke({ color: hexToNum(rowColor), width: isWinner ? 2 : 1, alpha: 0.65 });
      const name = promptText(
        player.id === gameOver.me.id ? `${player.name} · You` : player.name,
        11,
        this.theme.appTheme.foreground,
        { weight: "600", width: panelWidth - 210, truncate: true },
      );
      name.position.set(30, rowY + 8);
      const life = promptText(`${player.life} life`, 11, this.theme.appTheme["muted-foreground"], {
        weight: "600",
      });
      life.anchor.set(1, 0.5);
      life.position.set(panelWidth - 116, rowY + 15);
      const statusLabel = isWinner
        ? "WINNER"
        : player.status === "conceded"
          ? "CONCEDED"
          : player.status === "lost"
            ? "LOST"
            : "PLAYING";
      const status = promptText(
        statusLabel,
        9,
        isWinner ? this.theme.gameTheme.success : rowColor,
        { weight: "700", letterSpacing: 0.7 },
      );
      status.anchor.set(1, 0.5);
      status.position.set(panelWidth - 30, rowY + 15);
      group.addChild(row, name, life, status);
      rowY += 36;
    }

    const button = this.makeButton("RETURN TO MENU", gameOver.onEndGame, {
      color,
      width: 170,
      height: 44,
      icon: "lucide-log-out",
    });
    button.position.set((panelWidth - button.buttonWidth) / 2, panelHeight - 56);
    group.addChild(button);
    group.position.set(
      (this.viewportWidth - panelWidth) / 2,
      (this.viewportHeight - panelHeight) / 2,
    );
    this.container.addChild(group);
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
        onDrop,
        resolveDropPosition,
        onDragMove,
      };
      item.origin.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      event.stopPropagation();
    });
  }

  private startDragFeedback(drag: DragState): void {
    drag.hasMoved = true;
    drag.item.cursor = "grabbing";
    drag.item.alpha = 1;
    drag.item.zIndex = 1000;
  }

  private moveDrag(event: FederatedPointerEvent): void {
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

  private updateDragMotion(deltaMs: number): void {
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

  private finishDrag(event: FederatedPointerEvent): void {
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

  private animateDragRelease(
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

  private completeDragVisual(drag: DragState, destination: { x: number; y: number }): void {
    drag.settleTween?.kill();
    drag.settleTween = null;
    drag.item.position.set(destination.x, destination.y);
    drag.item.rotation = drag.restRotation;
    drag.item.scale.set(drag.restScaleX, drag.restScaleY);
    drag.item.origin.set(drag.restOriginX, drag.restOriginY);
    drag.item.cursor = "grab";
    drag.item.eventMode = "static";
    drag.item.alpha = 1;
    if (!drag.ring.destroyed) drag.ring.destroy();
  }

  private setDropZoneHighlight(x: number, y: number): void {
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

  private resetDropZones(): void {
    for (const zone of this.dropZones) {
      gsap.killTweensOf(zone.visual);
      zone.targetAlpha = 1;
      zone.visual.alpha = 1;
      if (zone.marker) zone.marker.visible = false;
    }
  }

  private cancelDrag(): void {
    const drag = this.drag;
    this.drag = null;
    if (drag) {
      this.completeDragVisual(drag, { x: drag.originX, y: drag.originY });
    }
    this.resetDropZones();
  }

  private cancelPointerDrag(event: FederatedPointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.cancelDrag();
    this.rebuild();
  }

  private setSelectionFilterFocused(focused: boolean): void {
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

  private handleKey(event: KeyboardEvent): void {
    if (topModal() || event.defaultPrevented || event.isComposing) return;
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
    } else if (
      (input.type === "coinFlipped" ||
        input.type === "diceRolled" ||
        input.type === "planarDieRolled") &&
      this.rollElapsedMs >= this.rollDurationMs
    ) {
      event.preventDefault();
      if (input.type === "coinFlipped") {
        this.spec.respond({ type: "coinFlippedAcknowledged" });
      } else if (input.type === "diceRolled") {
        this.spec.respond({ type: "diceRolledAcknowledged" });
      } else {
        this.spec.respond({ type: "planarDieRolledAcknowledged" });
      }
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

  private syncRollVisuals(): void {
    if (this.rollSettled) return;
    if (!animationsEnabled()) {
      this.stopRollAnimation();
      this.rollElapsedMs = this.rollDurationMs;
      this.settleRollVisuals();
      return;
    }
    if (this.rollTimeline) {
      this.rollElapsedMs = Math.min(this.rollDurationMs, this.rollTimeline.time() * 1000);
    }
    for (const visual of this.rollVisuals) {
      if (visual.token.kind === "die") {
        setRollTokenValue(
          visual.token,
          rollingDieValue(visual.sides, this.rollElapsedMs, visual.seed),
        );
      } else if (visual.token.kind === "coin") {
        setRollTokenValue(
          visual.token,
          Math.floor(this.rollElapsedMs / 62 + visual.index) % 2 === 0 ? "heads" : "tails",
        );
      } else {
        const faces = ["planeswalk", "chaos", "blank"];
        setRollTokenValue(
          visual.token,
          faces[Math.floor(this.rollElapsedMs / 76 + visual.index) % faces.length]!,
        );
      }
    }
  }

  update(deltaMs: number): void {
    const elapsed = performance.now();
    this.updateDragMotion(deltaMs);
    this.syncActionFeedback(elapsed);
    if (this.selectionFilterView) {
      this.selectionFilterView.caret.visible =
        this.selectionFilterFocused &&
        (!animationsEnabled() ||
          (elapsed - this.selectionFilterBlinkAt) % FILTER_CARET_PERIOD_MS <
            FILTER_CARET_PERIOD_MS / 2);
    }
    if (!animationsEnabled() && this.entranceTween) this.entranceTween.progress(1);
    if (animationsEnabled()) {
      const actionPulse = (1 - Math.cos((elapsed / 3600) * Math.PI * 2)) / 2;
      for (const { node, maxAlpha } of this.actionPulseNodes) {
        node.alpha = maxAlpha * (0.8 + actionPulse * 0.2);
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
    const isRollResult =
      input?.type === "coinFlipped" ||
      input?.type === "diceRolled" ||
      input?.type === "planarDieRolled";
    if (!this.modalOpen || !isRollResult || this.rollSettled) return;
    this.syncRollVisuals();
  }
}
