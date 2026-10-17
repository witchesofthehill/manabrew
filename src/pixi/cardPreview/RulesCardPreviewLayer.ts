import {
  Container,
  FederatedPointerEvent,
  Graphics,
  Point,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
} from "pixi.js";
import type { CardDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import type { ScryfallCard } from "@/types/scryfall";
import type { PreviewFlipOptions, PreviewPhase } from "@/lib/cardPreview";
import { isCoarsePointer } from "@/lib/responsive";
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { Theme } from "@/hooks/useTheme";
import {
  deriveCardPresentation,
  type CardStatPresentation,
} from "@/components/game/cardPresentation";
import { getPreviewActionShortcut } from "@/components/game/game.utils";
import { hexToNum } from "@/pixi/colorUtils";
import { PixiRichText } from "@/pixi/cardPreview/PixiRichText";
import { PixiCardRailPreview } from "@/pixi/cardPreview/PixiCardRailPreview";
import {
  localizeRulesPreviewText,
  resolveRulesPreviewDisplay,
  rulesEntryMatchesStackAbility,
  rulesTextEntries,
} from "@/pixi/cardPreview/rulesCardPreviewPresentation";
import { RulesPreviewActions } from "@/pixi/cardPreview/RulesPreviewActions";
import {
  drawRulesStatBadge,
  resolveRulesPreviewFrame,
  rulesCardRadius,
  RULES_BODY_FONT,
  RULES_CARD_CONSTRAINTS,
  RULES_TITLE_FONT,
  type RulesPreviewFrameStyle,
} from "@/pixi/cardPreview/rulesPreviewFrame";
import { loadCardBack } from "@/pixi/cardBackTexture";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import { useGameStore } from "@/stores/useGameStore";
import { asGameDeckCard } from "@/lib/decks";
import { deckCardToPreviewDto, previewDtoDeckCard } from "@/lib/scryfall.utils";
import { gsap } from "@/pixi/effects/gsap";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { PREVIEW_TIMING } from "@/lib/cardPreview";
import { HandCardControls } from "@/pixi/HandCardControls";
import { containsPreviewHoverBridge } from "@/pixi/cardPreview/previewHoverArea";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
import { parseManaCost } from "@/pixi/manaSymbols";
import {
  CARD_PREVIEW_EDGE_PAD as EDGE_PAD,
  computePreviewLayout,
  type PreviewLayout,
} from "@/components/game/cardPreviewLayout";
import { GAME_CARD_SIZES, IN_GAME_CARD_PREVIEW_SCALES } from "@/components/game/game.constants";
import { getSafeAreaInsets } from "@/lib/safeArea";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { renderRulesCard } from "@/lib/cardRenderer";
import { CardArtworkError } from "@/lib/cardRenderDecision";
import { hasIntegratedArtwork } from "@/lib/cardArtworkPrinting";
import {
  getCardRenderGeometry,
  getCardInteractionRegion,
  CARD_RENDER_WIDTH,
  type CardRenderGeometry,
} from "@/lib/cardRenderGeometry";
import {
  createGeneratedCardTexture,
  getGeneratedCardArtWindows,
} from "@/pixi/generatedCardTexture";
import { writeCardTextureUvs } from "@/pixi/cardTextureUvs";
import { CardFoil } from "@/pixi/effects/CardFoil";
import { CardLiveHighlight } from "@/pixi/effects/CardLiveHighlight";
import { isEtchedOnlyPrinting } from "@/lib/cardFinish";

export interface RulesCardPreviewSpec {
  card: CardDto;
  phase: Exclude<PreviewPhase, "hidden">;
  sticky: boolean;
  showBackFace: boolean;
  placement: "auto" | "top-center" | "pinned";
  suppressed: boolean;
  skipEnterAnimation: boolean;
  actions: HandActionOption[];
  anchor: { x: number; y: number; width: number; height: number } | null;
  reserveSidePanel: boolean;
  pointer: { x: number; y: number };
  slot: { x: number; y: number; width: number; height: number } | null;
  embedded?: boolean;
  highlightedEffect?: string;
}

export interface RulesPreviewActionGlowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  opacity: number;
}

export interface RulesCardPreviewCallbacks {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onInteractionReady: () => void;
  onRenderRequested: () => void;
  onSelectAction: (action: HandActionOption) => void;
  onDismiss: () => void;
  onFlip: (options?: PreviewFlipOptions) => void;
  onToggleView: () => void;
}

const PORTRAIT_WIDTH: number = RULES_CARD_CONSTRAINTS.width;
const PORTRAIT_HEIGHT: number = RULES_CARD_CONSTRAINTS.height;
const LANDSCAPE_WIDTH = PORTRAIT_HEIGHT;
const LANDSCAPE_HEIGHT = PORTRAIT_WIDTH;
const MAX_PREVIEW_SCALE = GAME_CARD_SIZES.preview.width / PORTRAIT_WIDTH;
const PREVIEW_CONTROL_SIZE = 32;
const TOUCH_PREVIEW_CONTROL_SIZE = 44;
const PORTRAIT_HEADER_HEIGHT = 52;
const STAT_BADGE_HEIGHT = 40;
const RULES_INSET = 4;
const SCAN_OVERLAY_TOP_FRACTION = 0.62;
const SCAN_OVERLAY_INSET = 8;
const SCAN_OVERLAY_OPACITY = 0.94;
const SCAN_COST_SYMBOL_SIZE = 22;
const SCAN_COST_PADDING = 6;
const CONTENT_PAD = 16;
const ORACLE_LINE_HEIGHT = 20;
const FLAVOR_FONT_SIZE = 13;
const FLAVOR_LINE_HEIGHT = 17;
const FLAVOR_MANA_SIZE = 15;
const ABILITY_GAP = 12;
const ENTRY_INTERACTION_PAD_MS = 80;
const STACK_RULES_PULSE_S = 0.9;
const SCROLL_DRAG_SLOP = 5;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function previewDeckCard(card: CardDto): DeckCard {
  return previewDtoDeckCard(card) ?? asGameDeckCard(useGameStore.getState().gameDecks, card);
}

function textStyle(
  fill: string,
  fontSize: number,
  fontWeight: "400" | "500" | "600" | "700" = "400",
  fontFamily = "Inter, system-ui, sans-serif",
): TextStyle {
  return new TextStyle({ fill, fontSize, fontWeight, fontFamily, lineHeight: fontSize * 1.3 });
}

function oracleTextStyle(fill: string, italic = false, fontFamily = RULES_BODY_FONT): TextStyle {
  return new TextStyle({
    fill,
    fontFamily,
    fontSize: 15,
    fontWeight: "400",
    fontStyle: italic ? "italic" : "normal",
    lineHeight: ORACLE_LINE_HEIGHT,
  });
}

function flavorTextStyle(fill: string, fontFamily = RULES_BODY_FONT): TextStyle {
  return new TextStyle({
    fill,
    fontFamily,
    fontSize: FLAVOR_FONT_SIZE,
    fontWeight: "400",
    fontStyle: "italic",
    lineHeight: FLAVOR_LINE_HEIGHT,
  });
}

export class RulesCardPreviewLayer {
  readonly container = new Container({ isRenderGroup: true });
  private cardContainer = new Container();
  private fieldFace = new Container();
  private detailsContainer = new Container();
  private detailsHeight = PORTRAIT_HEIGHT;
  private faceSprite = new Sprite(Texture.EMPTY);
  private faceMask = new Graphics();
  private faceGeometry: CardRenderGeometry | undefined;
  private rulesRegion = new Rectangle();
  private fallbackFace = new Container();
  private faceTexture: Texture | null = null;
  private foil: CardFoil | null = null;
  private readonly liveHighlight: CardLiveHighlight;
  private readonly foilUvs = new Float32Array(8);
  private readonly foilSurface = new Rectangle();
  private readonly foilRulesExclusion = new Rectangle();
  private renderAbort: AbortController | null = null;
  private unsubscribeLocale: () => void;
  private renderState: "loading" | "ready" | "error" = "loading";
  private preserveArtwork = false;
  private scanOverlay = false;
  private cardBounds = new Rectangle();
  private anchorBounds = new Rectangle();
  private pointerOnPreview = false;
  private layoutX = 0;
  private layoutY = 0;
  private layoutScale = 1;

  private theme: Theme;
  private frame: RulesPreviewFrameStyle;
  private callbacks: RulesCardPreviewCallbacks;
  private background = new Graphics();
  private chrome = new Container();
  private bodyScroller = new Container();
  private bodyContent = new Container();
  private bodyMask = new Graphics();
  private scrollTrack = new Graphics();
  private scrollThumb = new Graphics();
  private footer = new Container();
  private actions = new RulesPreviewActions();
  private controls = new RulesPreviewActions();
  private viewControls: HandCardControls;
  private spec: RulesCardPreviewSpec | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private panelWidth = PORTRAIT_WIDTH;
  private panelHeight = PORTRAIT_HEIGHT;
  private widgetHeight = PORTRAIT_HEIGHT;
  private faceWidth = PORTRAIT_WIDTH;
  private headerHeight = 0;
  private bodyTop = RULES_INSET;
  private bodyHeight = 0;
  private readonly statBounds = new Rectangle();
  private contentX = CONTENT_PAD;
  private contentWidth = PORTRAIT_WIDTH - CONTENT_PAD * 2;
  private artY = PORTRAIT_HEADER_HEIGHT;
  private contentHeight = 0;
  private scrollOffset = 0;
  private artGeneration = 0;
  private cardInfoGeneration = 0;
  private scryfallInfo: ScryfallCard | null = null;
  private displayedBackFace = false;
  private canFlip = false;
  private interactiveReady = false;
  private interactionTimer: number | null = null;
  private dragPointerId: number | null = null;
  private bodyPointerId: number | null = null;
  private dragStart = new Point();
  private dragPrevious = new Point();
  private dragLocal = new Point();
  private dragMoved = false;
  private bodyTapCancelled = false;
  private revealHighlightedEffect = false;
  private highlightedEffectTween: gsap.core.Tween | null = null;
  private highlightedRows: Container[] = [];
  private highlightedRowTop: number | null = null;

  private previewSize = usePreferencesStore.getState().inGameCardPreviewSize;
  private readonly unsubscribePreferences: () => void;
  constructor(theme: Theme, callbacks: RulesCardPreviewCallbacks) {
    this.theme = theme;
    this.frame = resolveRulesPreviewFrame(theme);
    this.callbacks = callbacks;
    this.viewControls = new HandCardControls(
      theme,
      isCoarsePointer() ? TOUCH_PREVIEW_CONTROL_SIZE : PREVIEW_CONTROL_SIZE,
    );
    this.container.visible = false;
    this.container.sortableChildren = true;
    this.container.eventMode = "static";
    this.container.cursor = "default";
    this.container.on("pointerdown", (event: FederatedPointerEvent) => {
      if (event.pointerId === this.bodyPointerId) this.bodyPointerId = null;
      if (!this.spec?.embedded) event.stopPropagation();
    });
    this.container.on("pointertap", (event: FederatedPointerEvent) => {
      if (event.pointerId === this.bodyPointerId) event.stopPropagation();
    });
    this.container.hitArea = {
      contains: (x, y) => this.interactiveReady && this.containsHoverArea(x, y),
    };
    this.unsubscribeLocale = useScryfallStore.subscribe((state, previous) => {
      if (state.locale === previous.locale || !this.spec) return;
      this.scryfallInfo = null;
      void this.loadCardInfo();
      void this.loadFace();
    });

    this.bodyScroller.mask = this.bodyMask;
    this.bodyScroller.addChild(this.bodyContent);
    this.bodyScroller.eventMode = "static";
    this.bodyScroller.on("pointerdown", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      if (this.dragPointerId !== null) return;
      this.bodyPointerId = event.pointerId;
      this.bodyTapCancelled = false;
      if (event.pointerType !== "touch") return;
      this.dragPointerId = event.pointerId;
      this.dragStart.copyFrom(event.global);
      this.dragPrevious.copyFrom(event.global);
      this.dragMoved = false;
    });
    this.bodyScroller.on("globalpointermove", (event: FederatedPointerEvent) => {
      if (event.pointerId !== this.dragPointerId) return;
      this.dragMoved ||=
        Math.hypot(event.global.x - this.dragStart.x, event.global.y - this.dragStart.y) >
        SCROLL_DRAG_SLOP;
      if (!this.dragMoved) return;
      this.bodyTapCancelled = true;
      this.revealHighlightedEffect = false;
      this.bodyScroller.toLocal(this.dragPrevious, undefined, this.dragLocal);
      const previousY = this.dragLocal.y;
      this.bodyScroller.toLocal(event.global, undefined, this.dragLocal);
      this.setScroll(this.scrollOffset + previousY - this.dragLocal.y);
      this.dragPrevious.copyFrom(event.global);
    });
    const endDrag = (event: FederatedPointerEvent) => {
      if (event.pointerId !== this.dragPointerId) return;
      this.bodyTapCancelled ||= this.dragMoved || event.type === "pointercancel";
      this.dragPointerId = null;
    };
    this.bodyScroller.on("pointerup", endDrag);
    this.bodyScroller.on("pointerupoutside", endDrag);
    this.bodyScroller.on("pointercancel", endDrag);
    this.bodyScroller.on("pointertapcapture", (event: FederatedPointerEvent) => {
      if (this.bodyTapCancelled) event.stopImmediatePropagation();
    });
    this.bodyScroller.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
    });
    const requestRender = () => this.callbacks.onRenderRequested();
    this.actions.on("pointerover", requestRender);
    this.actions.on("pointerout", requestRender);
    this.controls.on("pointerover", requestRender);
    this.controls.on("pointerout", requestRender);

    this.faceSprite.eventMode = "none";
    this.faceSprite.mask = this.faceMask;
    this.liveHighlight = new CardLiveHighlight(requestRender);
    this.fieldFace.addChild(this.fallbackFace, this.faceSprite);
    this.detailsContainer.addChild(
      this.background,
      this.chrome,
      this.bodyScroller,
      this.bodyMask,
      this.scrollTrack,
      this.scrollThumb,
      this.footer,
    );
    this.cardContainer.addChild(this.fieldFace, this.faceMask);
    this.container.addChild(
      this.cardContainer,
      this.liveHighlight,
      this.detailsContainer,
      this.viewControls,
    );
    this.unsubscribePreferences = usePreferencesStore.subscribe((state, previous) => {
      if (state.inGameCardPreviewSize === previous.inGameCardPreviewSize) return;
      this.previewSize = state.inGameCardPreviewSize;
      if (!this.spec || this.spec.embedded || this.spec.phase !== "open") return;
      gsap.killTweensOf(this.container);
      gsap.killTweensOf(this.container.scale);
      this.layoutPanel();
      this.callbacks.onRenderRequested();
    });
  }
  get artworkTop(): number {
    return this.container.y + this.artY * this.container.scale.y;
  }
  get imageReady(): boolean {
    return (
      this.faceSprite.texture !== Texture.EMPTY &&
      (this.faceTexture !== null || this.renderState === "error")
    );
  }
  get liveHighlights(): CardLiveHighlight {
    return this.liveHighlight;
  }
  get foilTexture(): Texture | null {
    return this.spec &&
      !this.spec.card.isFaceDown &&
      this.spec.card.identity.name &&
      this.imageReady
      ? this.faceSprite.texture
      : null;
  }
  writeFoilTextureUvs(relativeTo: Container, surface: Rectangle, output: Float32Array): void {
    writeCardTextureUvs(this.faceSprite, relativeTo, surface, output);
  }
  get foilExclusion(): { x: number; y: number; width: number; height: number } | null {
    if (!this.detailsContainer.visible) return null;
    return {
      x: this.container.x + this.detailsContainer.x * this.container.scale.x,
      y: this.container.y + this.detailsContainer.y * this.container.scale.y,
      width: this.rulesRegion.width * this.container.scale.x,
      height: this.detailsHeight * this.container.scale.y,
    };
  }

  setCallbacks(callbacks: RulesCardPreviewCallbacks): void {
    this.callbacks = callbacks;
  }

  setTheme(theme: Theme): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.viewControls.setTheme(theme);
    if (this.spec) {
      void this.loadFace();
      this.rebuild();
    }
  }

  setViewport(width: number, height: number): void {
    if (width === this.viewportWidth && height === this.viewportHeight) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    if (width <= EDGE_PAD * 2 || height <= EDGE_PAD * 2) this.setSpec(null);
    else if (this.spec) this.rebuild();
  }

  setSpec(spec: RulesCardPreviewSpec | null, preserveHover = false): void {
    const previous = this.spec;
    this.spec = spec;
    if (!spec || this.viewportWidth <= EDGE_PAD * 2 || this.viewportHeight <= EDGE_PAD * 2) {
      this.spec = null;
      this.renderAbort?.abort();
      this.hide(
        preserveHover && this.viewportWidth > EDGE_PAD * 2 && this.viewportHeight > EDGE_PAD * 2,
      );
      return;
    }

    const cardChanged = previous?.card.id !== spec.card.id;
    const lookupChanged =
      cardChanged ||
      previous?.card.identity.name !== spec.card.identity.name ||
      previous?.card.identity.setCode !== spec.card.identity.setCode ||
      previous?.card.identity.cardNumber !== spec.card.identity.cardNumber;
    const faceChanged = previous?.showBackFace !== spec.showBackFace;
    const hidden = spec.card.isFaceDown || !spec.card.identity.name;
    const visibilityChanged =
      !previous || (previous.card.isFaceDown || !previous.card.identity.name) !== hidden;
    const contentChanged = !previous || previous.card !== spec.card;
    const actionsChanged =
      !previous ||
      previous.actions.length !== spec.actions.length ||
      previous.actions.some((action, index) => action !== spec.actions[index]);
    const embeddedChanged = previous?.embedded !== spec.embedded;
    const highlightChanged = previous?.highlightedEffect !== spec.highlightedEffect;
    this.displayedBackFace = spec.showBackFace;
    if (lookupChanged || faceChanged || visibilityChanged) {
      this.clearFaceTexture();
      this.faceGeometry = undefined;
      this.preserveArtwork = false;
    }
    if (lookupChanged || visibilityChanged) {
      this.cardInfoGeneration += 1;
      const identity = spec.card.identity.isToken
        ? previewDeckCard(spec.card).identity
        : spec.card.identity;
      const lookup = {
        name: identity.name,
        setCode: identity.setCode || undefined,
        collectorNumber: identity.cardNumber || undefined,
      };
      const cards = useScryfallStore.getState().cards;
      this.scryfallInfo = hidden
        ? null
        : (peekCard(cards, lookup) ?? peekCard(cards, { name: lookup.name }));
      if (!this.scryfallInfo) void this.loadCardInfo();
    }
    if (lookupChanged || faceChanged || visibilityChanged) {
      this.scrollOffset = 0;
      this.dragPointerId = null;
      this.bodyTapCancelled = true;
      this.actions.reset();
    }
    if (lookupChanged || faceChanged || visibilityChanged || highlightChanged) {
      this.revealHighlightedEffect = !!spec.highlightedEffect;
    }
    if (contentChanged || faceChanged || visibilityChanged) void this.loadFace();
    if (
      contentChanged ||
      actionsChanged ||
      faceChanged ||
      previous?.sticky !== spec.sticky ||
      previous?.suppressed !== spec.suppressed ||
      previous?.phase !== spec.phase ||
      embeddedChanged ||
      highlightChanged
    ) {
      this.rebuild();
    } else {
      this.layoutPanel();
    }

    if (spec.suppressed) {
      this.hide();
      return;
    }

    if (!previous || previous.phase !== spec.phase || previous.suppressed) {
      if (spec.phase === "closing") {
        if (spec.slot) this.hide();
        else this.animateOut();
      } else if (spec.skipEnterAnimation || spec.slot) this.showImmediately();
      else this.animateIn(previous == null);
    } else if (spec.phase === "open") {
      this.container.visible = true;
      this.container.alpha = 1;
    }
  }

  hitTest(x: number, y: number): boolean {
    if (
      !this.spec ||
      this.spec.phase !== "open" ||
      this.spec.suppressed ||
      !this.container.visible ||
      !this.interactiveReady
    ) {
      return false;
    }
    const localX = (x - this.container.x) / this.container.scale.x;
    const localY = (y - this.container.y) / this.container.scale.y;
    return this.cardBounds.contains(localX, localY);
  }

  hitTestHover(x: number, y: number): boolean {
    return (
      this.spec?.phase === "open" &&
      !this.spec.suppressed &&
      this.container.visible &&
      this.containsHoverArea(
        (x - this.layoutX) / this.layoutScale,
        (y - this.layoutY) / this.layoutScale,
      )
    );
  }

  readActionGlowBounds(target: RulesPreviewActionGlowBounds): boolean {
    const spec = this.spec;
    if (!spec || spec.actions.length === 0 || spec.suppressed || !this.container.visible) {
      return false;
    }
    const scale = this.container.scale.x;
    target.x = this.container.x;
    target.y = this.container.y;
    target.width = this.panelWidth * scale;
    target.height = this.panelHeight * scale;
    target.radius = rulesCardRadius(this.faceWidth, this.panelHeight) * scale;
    target.opacity = this.container.alpha;
    return target.opacity > 0;
  }

  updateHover(x: number, y: number): boolean {
    if (this.spec?.phase !== "open" || this.spec.suppressed || !this.container.visible) {
      this.clearHover();
      return false;
    }
    const localX = (x - this.layoutX) / this.layoutScale;
    const localY = (y - this.layoutY) / this.layoutScale;
    const inside = this.containsHoverArea(localX, localY);
    if (inside || (this.pointerOnPreview && this.anchorBounds.contains(localX, localY))) {
      this.pointerOnPreview = true;
      this.callbacks.onPointerEnter();
    } else {
      this.clearHover();
    }
    return inside && this.interactiveReady;
  }

  clearHover(): void {
    if (!this.pointerOnPreview) return;
    this.pointerOnPreview = false;
    this.callbacks.onPointerLeave();
  }

  private containsHoverArea(x: number, y: number): boolean {
    return (
      this.cardBounds.contains(x, y) ||
      (!!this.spec &&
        !this.spec.sticky &&
        containsPreviewHoverBridge(x, y, this.anchorBounds, this.cardBounds))
    );
  }

  focusAction(delta: number): void {
    if (!this.spec?.actions.length) return;
    this.actions.focusAction(delta);
    const row = this.actions.focusedActionBounds;
    if (row) this.scrollIntoView(this.actions.y + row.top, row.height);
    this.callbacks.onRenderRequested();
  }

  focusActionAt(index: number): void {
    if (!this.spec?.actions.length) return;
    this.actions.focusActionAt(index);
    const row = this.actions.focusedActionBounds;
    if (row) this.scrollIntoView(this.actions.y + row.top, row.height);
    this.callbacks.onRenderRequested();
  }

  getActionScreenBounds(index: number) {
    const bounds = this.actions.getActionScreenBounds(index);
    if (!bounds || !this.bodyScroller.visible) return null;
    const clip = this.bodyMask.getBounds();
    const x = Math.max(bounds.x, clip.x);
    const y = Math.max(bounds.y, clip.y);
    const right = Math.min(bounds.x + bounds.width, clip.x + clip.width);
    const statTop = this.footer.visible
      ? this.detailsContainer.toGlobal({ x: 0, y: this.statBounds.y }).y
      : clip.y + clip.height;
    const bottom = Math.min(bounds.y + bounds.height, clip.y + clip.height, statTop);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
  }

  getCardScreenBounds() {
    const top = this.container.toGlobal({ x: 0, y: 0 });
    const bottom = this.container.toGlobal({ x: this.panelWidth, y: this.panelHeight });
    return { x: top.x, y: top.y, width: bottom.x - top.x, height: bottom.y - top.y };
  }

  activateFocusedAction(): void {
    this.actions.activateFocusedAction();
    this.callbacks.onRenderRequested();
  }

  activateShortcut(shortcut: number): boolean {
    if (!this.spec?.actions.length) return false;
    return this.actions.activateShortcut(shortcut);
  }

  private scrollIntoView(top: number, height: number): void {
    const visibleHeight = this.footer.visible
      ? Math.max(1, Math.min(this.bodyHeight, this.statBounds.y - this.bodyTop))
      : this.bodyHeight;
    if (top < this.scrollOffset) this.setScroll(top);
    else if (top + height > this.scrollOffset + visibleHeight) {
      this.setScroll(height > visibleHeight ? top : top + height - visibleHeight);
    }
  }

  activatePrimaryTransform(): void {
    if (this.canFlip) this.callbacks.onFlip();
  }

  scrollBy(delta: number, mode: number, _x: number, _y: number): void {
    this.bodyTapCancelled = true;
    this.revealHighlightedEffect = false;
    this.actions.cancelPress();
    this.controls.cancelPress();
    const transform = this.bodyScroller.worldTransform;
    const scale = Math.hypot(transform.c, transform.d);
    const unit =
      mode === 1 ? ORACLE_LINE_HEIGHT : mode === 2 ? this.bodyHeight : scale > 0 ? 1 / scale : 0;
    this.setScroll(this.scrollOffset + delta * unit);
  }

  private drawScanManaCost(cost: string): void {
    const symbols = parseManaCost(cost);
    if (symbols.length === 0) return;
    const mana = new PixiRichText();
    mana.setContent(
      symbols.map((symbol) => `{${symbol}}`).join(""),
      textStyle(this.frame.ink, SCAN_COST_SYMBOL_SIZE, "600"),
      Number.MAX_SAFE_INTEGER,
      SCAN_COST_SYMBOL_SIZE,
    );
    mana.scale.set(
      Math.min(1, (this.panelWidth - CONTENT_PAD * 2 - SCAN_COST_PADDING * 2) / mana.width),
    );
    const width = mana.width + SCAN_COST_PADDING * 2;
    const height = mana.height + SCAN_COST_PADDING * 2;
    const x = this.panelWidth - CONTENT_PAD - width - this.rulesRegion.x;
    const y = CONTENT_PAD - this.rulesRegion.y;
    const background = new Graphics()
      .roundRect(x, y, width, height, RULES_CARD_CONSTRAINTS.radius)
      .fill({ color: hexToNum(this.frame.paper), alpha: SCAN_OVERLAY_OPACITY });
    mana.position.set(x + SCAN_COST_PADDING, y + SCAN_COST_PADDING);
    background.eventMode = "none";
    mana.eventMode = "none";
    this.chrome.addChild(background, mana);
  }

  private rebuild(): void {
    const spec = this.spec;
    if (!spec || this.viewportWidth <= 0 || this.viewportHeight <= 0) return;
    this.bodyTapCancelled = true;
    this.highlightedEffectTween?.kill();
    this.highlightedEffectTween = null;
    this.highlightedRows = [];
    this.highlightedRowTop = null;
    this.fieldFace.visible = true;
    this.actions.removeFromParent();
    this.controls.removeFromParent();
    this.chrome.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.bodyContent.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.footer.removeChildren().forEach((child) => child.destroy({ children: true }));

    const deckCard = previewDeckCard(spec.card);
    const presentationCard =
      spec.card.types.length === 0 && spec.card.text.length === 0
        ? deckCardToPreviewDto(deckCard)
        : spec.card;
    const presentation = deriveCardPresentation(presentationCard);
    const display = resolveRulesPreviewDisplay({
      card: spec.card,
      presentation,
      info: this.scryfallInfo,
      deckLayout: deckCard.layout,
      showBackFace: this.displayedBackFace,
      faceless: spec.card.isFaceDown || !spec.card.identity.name,
    });
    const progression =
      display.currentFace && !display.multipart && !display.faceless && presentation.progression
        ? {
            ...presentation.progression,
            effects: presentation.progression.effects.map((effect) => ({
              ...effect,
              text: localizeRulesPreviewText(effect.text, this.scryfallInfo, display.liveFaceIndex),
            })),
          }
        : null;
    const nextClassLevel =
      progression?.rail.kind === "class" && progression.rail.current < progression.rail.max
        ? progression.rail.current + 1
        : null;
    const classLevelUpIndex = nextClassLevel
      ? spec.actions.findIndex((action) => action.isClassLevelUp)
      : -1;
    const classActionIndex = classLevelUpIndex >= 0 ? classLevelUpIndex : null;
    const indexedActions = (display.faceless ? [] : spec.actions).map((action, index) => ({
      action,
      shortcut: getPreviewActionShortcut(
        index,
        classActionIndex,
        classActionIndex === null ? null : nextClassLevel,
      ),
      displayLabel: localizeRulesPreviewText(
        action.label,
        this.scryfallInfo,
        display.liveFaceIndex,
      ),
    }));
    this.canFlip = display.flippable;
    const landscape = display.horizontal;
    this.configureGeometry(landscape);
    this.viewControls.setSpec(
      spec.embedded
        ? null
        : {
            rulesView: true,
            horizontal: false,
            alternateFace: false,
            showFaceControl: false,
            onToggleRules: () => this.callbacks.onToggleView(),
            onToggleFace: () => undefined,
          },
      this.panelWidth,
      this.artY,
      1,
      1,
    );
    this.background.clear();
    this.frame = resolveRulesPreviewFrame(
      this.theme,
      this.faceGeometry?.rules[0],
      this.scanOverlay,
    );

    if (this.scanOverlay && display.typeLine) this.addTypeHeading(display.typeLine);
    if (this.scanOverlay && !display.faceless) this.drawScanManaCost(display.manaCost);
    this.detailsContainer.visible = !display.faceless;
    this.bodyScroller.visible = true;
    this.fitFace();
    const showFoil = !spec.embedded && !display.faceless && !spec.suppressed && this.imageReady;
    const faceWidth =
      this.faceSprite.rotation === 0 ? this.faceSprite.width : this.faceSprite.height;
    const faceHeight =
      this.faceSprite.rotation === 0 ? this.faceSprite.height : this.faceSprite.width;
    if (showFoil) {
      if (!this.foil) {
        this.foil = new CardFoil(() => this.callbacks.onRenderRequested());
        this.container.addChildAt(this.foil, 1);
      }
      this.foilSurface.set(
        this.scanOverlay ? (this.faceWidth - faceWidth) / 2 : 0,
        this.scanOverlay ? (this.panelHeight - faceHeight) / 2 : 0,
        this.scanOverlay ? faceWidth : this.panelWidth,
        this.scanOverlay ? faceHeight : this.panelHeight,
      );
      this.foil.setSurface(
        this.foilSurface.width,
        this.foilSurface.height,
        rulesCardRadius(this.faceWidth, this.panelHeight),
        this.theme,
      );
      this.foil.position.set(this.foilSurface.x, this.foilSurface.y);
      this.foilRulesExclusion.copyFrom(this.rulesRegion);
      this.foilRulesExclusion.x -= this.foilSurface.x;
      this.foilRulesExclusion.y -= this.foilSurface.y;
      this.foil.setExclusion(this.foilRulesExclusion);
      this.writeFoilTextureUvs(this.container, this.foilSurface, this.foilUvs);
      this.foil.setTexture(this.faceSprite.texture, this.foilUvs);
      this.foil.setArtWindows(getGeneratedCardArtWindows(this.faceSprite.texture));
    }
    this.foil?.setAppearance(
      !display.faceless && !!spec.card.foil,
      display.faceless ? undefined : spec.card.cosmetics,
      !display.faceless &&
        isEtchedOnlyPrinting(
          peekCard(useScryfallStore.getState().cards, {
            name: deckCard.identity.name,
            setCode: deckCard.identity.setCode || undefined,
            cardNumber: deckCard.identity.cardNumber || undefined,
          })?.finishes,
        ),
    );
    this.foil?.setEnabled(showFoil);
    if (!showFoil) this.foil?.setTexture(null);
    this.bodyScroller.position.set(this.contentX, this.bodyTop);
    let y = 2;
    this.actions.setContent({
      width: this.contentWidth,
      maxHeight: Number.POSITIVE_INFINITY,
      theme: this.theme,
      frame: this.frame,
      actions: indexedActions,
      controls: [],
      statuses: [],
      hint: "",
      label: "",
      onSelectAction: (action) => this.callbacks.onSelectAction(action),
      embedded: true,
      compact: this.bodyHeight < 48,
    });
    const visibleCounters =
      progression?.rail.kind === "saga"
        ? presentation.counters.filter((counter) => counter.type !== "Lore")
        : presentation.counters;
    if (display.keywords.length > 0) y = this.addKeywordChips(display.keywords, y);
    if (indexedActions.length > 0) {
      if (display.otherFace) {
        y = this.addStaticAbilityRow(i18n._(msg`Actions apply to the current face.`), y);
      }
      this.actions.visible = true;
      this.actions.position.set(0, y);
      this.bodyContent.addChild(this.actions);
      y += this.actions.panelHeight + 4;
    }
    for (const cost of display.costs) {
      y = this.addStaticAbilityRow(`${cost.label} ${cost.cost}`, y);
    }
    if (visibleCounters.length > 0) {
      y =
        this.addChips(
          visibleCounters.map((counter) => ({
            label: `${counter.type} ×${counter.count}`,
            color: this.theme.gameTheme.counter[counter.colorKey],
          })),
          y + 4,
        ) + 8;
    }
    if (progression) {
      const railY = y;
      const rail = new PixiCardRailPreview({
        state: progression.rail,
        effects: progression.effects,
        width: this.contentWidth,
        theme: this.theme,
        frame: this.frame,
        highlightedEffect: spec.highlightedEffect,
      });
      rail.position.set(0, railY);
      this.bodyContent.addChild(rail);
      this.highlightedRows.push(...rail.highlightedRows);
      if (rail.highlightedRowTop != null) {
        this.highlightedRowTop ??= railY + rail.highlightedRowTop;
      }
      y += rail.contentHeight + 8;
    }
    const rulesEntries = display.sections.map((section) =>
      rulesTextEntries(section.rulesText, progression, section.canonicalRulesText),
    );
    if (display.faceless) {
      y = this.addStaticAbilityRow(i18n._(msg`Card identity and rules are hidden.`), y);
    } else if (rulesEntries.some((entries) => entries.length > 0)) {
      for (const [sectionIndex, section] of display.sections.entries()) {
        let sectionY = y;
        if (display.multipart) {
          sectionY = this.addFaceHeading(
            section.name,
            section.manaCost,
            section.typeLine,
            sectionY,
          );
        }
        for (const text of rulesEntries[sectionIndex]!) {
          sectionY = this.addOracleAbilityRow(text, sectionY, section.planeswalker);
        }
        y = sectionY;
      }
    }
    for (const section of display.sections) {
      if (!section.flavorText) continue;
      if (display.multipart) {
        y = this.addFaceHeading(section.name, section.manaCost, section.typeLine, y);
      }
      y = this.addFlavorText(section.flavorText, y);
    }

    const controls: Array<{ label: string; activate: () => void }> = [];
    if (display.flippable && !spec.embedded) {
      controls.push({
        label: display.faceIndex === 0 ? i18n._(msg`Flip back · F`) : i18n._(msg`Flip front · F`),
        activate: () => this.callbacks.onFlip({ sticky: true }),
      });
    }
    this.controls.setContent({
      width: this.contentWidth,
      maxHeight: Number.POSITIVE_INFINITY,
      theme: this.theme,
      frame: this.frame,
      embedded: true,
      actions: [],
      controls,
      statuses: display.faceless ? [] : presentation.statuses,
      hint: display.otherFace
        ? i18n._(msg`Printed face · live state belongs to the other face`)
        : this.renderState === "error" && !this.scanOverlay
          ? i18n._(msg`Original printing · generated frame unavailable`)
          : "",
      label: "",
      onSelectAction: (action) => this.callbacks.onSelectAction(action),
    });
    if (this.controls.visible) {
      this.controls.position.set(0, y);
      this.bodyContent.addChild(this.controls);
      y += this.controls.panelHeight + 4;
    }
    if (display.stats?.damage) {
      y = this.addStaticAbilityRow(i18n._(msg`${display.stats.damage} damage`), y);
    }
    this.bodyScroller.position.set(this.contentX, this.bodyTop);
    this.drawFooter(display.stats, display.loyalty, display.defense);
    const contentBounds = this.bodyContent.getLocalBounds();
    const contentBottom = contentBounds.y + contentBounds.height;
    const overlapsStats =
      this.footer.visible &&
      this.bodyContent.children.some((child) => {
        const bounds = child.getBounds();
        const local = this.bodyContent.toLocal({
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height,
        });
        return (
          local.x + this.contentX > this.statBounds.x && local.y + this.bodyTop > this.statBounds.y
        );
      });
    const badgePadding = overlapsStats
      ? this.detailsHeight - this.statBounds.y + RULES_INSET
      : contentBottom > this.bodyHeight
        ? RULES_INSET
        : 0;
    this.contentHeight = contentBottom + badgePadding;
    this.widgetHeight = this.panelHeight;
    if (this.revealHighlightedEffect && this.highlightedRowTop !== null) {
      this.setScroll(Math.max(0, this.highlightedRowTop - 8));
      this.revealHighlightedEffect = false;
    } else {
      this.setScroll(this.scrollOffset);
    }
    if (this.highlightedRows.length > 0 && animationsEnabled()) {
      this.highlightedEffectTween = gsap.to(this.highlightedRows, {
        alpha: 0.72,
        duration: STACK_RULES_PULSE_S,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
    }
    this.layoutPanel();
  }

  private addFaceHeading(name: string, manaCost: string, typeLine: string, y: number): number {
    const nameText = new Text({
      text: name,
      style: new TextStyle({
        fill: this.frame.ink,
        fontFamily: RULES_TITLE_FONT,
        fontSize: 17,
        fontWeight: "700",
        wordWrap: true,
        wordWrapWidth: this.contentWidth - 98,
        lineHeight: 18,
      }),
    });
    nameText.resolution = 2;
    nameText.position.set(0, y);
    const mana = new PixiRichText();
    mana.setContent(
      parseManaCost(manaCost)
        .map((code) => `{${code}}`)
        .join(""),
      textStyle(this.frame.ink, 13, "600"),
      86,
      15,
      1,
    );
    mana.position.set(this.contentWidth - mana.width, y + 1);
    const type = new Text({
      text: typeLine,
      style: textStyle(this.frame.ink, 12, "600", RULES_BODY_FONT),
    });
    type.resolution = 2;
    type.position.set(0, y + Math.max(20, nameText.height) + 2);
    this.bodyContent.addChild(nameText, mana, type);
    return y + Math.max(42, nameText.height + 24) + ABILITY_GAP;
  }

  private addKeywordChips(keywords: string[], y: number): number {
    let x = 0;
    let rowHeight = 0;
    for (const keyword of keywords) {
      const separator = keyword.indexOf(":");
      const label = (separator < 0 ? keyword : keyword.slice(0, separator)).trim().toUpperCase();
      if (!label) continue;
      const mana =
        separator < 0
          ? ""
          : parseManaCost(keyword.slice(separator + 1))
              .map((code) => `{${code}}`)
              .join("");
      const content = new PixiRichText();
      const textHeight = content.setContent(
        mana ? `${label} ${mana}` : label,
        textStyle(this.theme.gameTheme.textOnTinted, 11, "700"),
        Math.max(1, this.contentWidth - 14),
        14,
        1,
      );
      const width = Math.min(this.contentWidth, content.width + 14);
      const height = Math.max(24, textHeight + 8);
      if (x > 0 && x + width > this.contentWidth) {
        x = 0;
        y += rowHeight + 5;
        rowHeight = 0;
      }
      const chip = new Container();
      const background = new Graphics();
      background.roundRect(0, 0, width, height, 7);
      background.fill({ color: hexToNum(this.theme.gameTheme.canvas.shadow), alpha: 0.82 });
      content.position.set(7, (height - textHeight) / 2);
      chip.position.set(x, y);
      chip.addChild(background, content);
      this.bodyContent.addChild(chip);
      x += width + 5;
      rowHeight = Math.max(rowHeight, height);
    }
    return y + rowHeight;
  }

  private addChips(items: Array<{ label: string; color: string }>, y: number): number {
    let x = 0;
    let rowHeight = 0;
    for (const item of items) {
      const label = new Text({
        text: item.label,
        style: textStyle(this.frame.ink, 11, "600"),
      });
      label.resolution = 2;
      label.scale.x = Math.min(1, (this.contentWidth - 14) / label.width);
      const width = Math.min(this.contentWidth, label.width + 14);
      const height = 21;
      if (x > 0 && x + width > this.contentWidth) {
        x = 0;
        y += rowHeight + 5;
        rowHeight = 0;
      }
      const chip = new Container();
      const background = new Graphics();
      background.roundRect(0, 0, width, height, 10.5);
      background.fill({
        color: hexToNum(this.frame.textured ? this.frame.ink : this.frame.paper),
        alpha: this.frame.textured ? 0.035 : 1,
      });
      background.roundRect(0, 0, width, height, 10.5);
      background.fill({ color: hexToNum(item.color), alpha: 0.14 });
      background.stroke({ color: hexToNum(item.color), alpha: 0.7, width: 1 });
      label.position.set(7, 3);
      chip.position.set(x, y);
      chip.addChild(background, label);
      this.bodyContent.addChild(chip);
      x += width + 5;
      rowHeight = Math.max(rowHeight, height);
    }
    return y + rowHeight;
  }

  private addStaticAbilityRow(text: string, y: number): number {
    const style = oracleTextStyle(this.frame.ink, false, this.frame.bodyFont);
    style.fontWeight = "700";
    return this.addOracleAbilityRow(text, y, false, this.bodyContent, style);
  }

  private addOracleAbilityRow(
    text: string,
    y: number,
    planeswalker: boolean,
    parent = this.bodyContent,
    style = oracleTextStyle(this.frame.ink, false, this.frame.bodyFont),
  ): number {
    const loyalty = planeswalker ? /^([+\-−]?\d+):\s*(.+)$/.exec(text) : null;
    const content = loyalty?.[2] ?? text;
    const contentX = loyalty ? 43 : 0;
    const row = new Container();
    const rich = new PixiRichText();
    const textHeight = rich.setContent(content, style, this.contentWidth - contentX, 17, 3, {
      parentheticalStyle: oracleTextStyle(this.frame.mutedInk, true, this.frame.bodyFont),
    });
    const height = Math.max(loyalty ? 34 : 0, textHeight + 4);
    rich.position.set(contentX, 2);
    row.position.set(0, y);
    const highlightedEffect = this.spec?.highlightedEffect?.trim();
    if (highlightedEffect && rulesEntryMatchesStackAbility(text, highlightedEffect)) {
      const color = hexToNum(this.theme.gameTheme.activeAction.active);
      const highlight = new Graphics()
        .roundRect(-4, 0, this.contentWidth + 8, height, 6)
        .fill({ color, alpha: 0.28 });
      const marker = new Graphics().roundRect(-4, 0, 4, height, 2).fill(color);
      row.addChild(highlight, marker);
      this.highlightedRows.push(row);
      this.highlightedRowTop ??= y;
    }
    row.addChild(rich);
    if (loyalty) {
      const badge = new Graphics();
      badge.poly([4, 7, 34, 7, 37, height / 2, 34, height - 7, 4, height - 7, 1, height / 2]);
      badge.fill({
        color: hexToNum(this.frame.raised),
        alpha: 1,
      });
      badge.stroke({ color: hexToNum(this.frame.border), width: 1 });
      const value = new Text({
        text: loyalty[1]!.replace("-", "−"),
        style: textStyle(this.frame.ink, 12, "700", RULES_TITLE_FONT),
      });
      value.resolution = 2;
      value.anchor.set(0.5);
      value.position.set(19, height / 2);
      row.addChild(badge, value);
    }
    parent.addChild(row);
    return y + height + ABILITY_GAP;
  }

  private addFlavorText(
    text: string,
    y: number,
    parent = this.bodyContent,
    width = this.contentWidth,
  ): number {
    const rich = new PixiRichText();
    const height = rich.setContent(
      text,
      flavorTextStyle(this.frame.mutedInk, this.frame.bodyFont),
      width,
      FLAVOR_MANA_SIZE,
      4,
    );
    const divider = new Graphics();
    divider.moveTo(0, y).lineTo(width, y);
    divider.stroke({ color: hexToNum(this.frame.border), alpha: 0.45, width: 1 });
    parent.addChild(divider);
    rich.position.set(0, y + 8);
    parent.addChild(rich);
    return y + height + 8 + ABILITY_GAP;
  }

  private configureGeometry(landscape: boolean): void {
    this.scanOverlay =
      this.preserveArtwork || (!!this.scryfallInfo && hasIntegratedArtwork(this.scryfallInfo));
    this.panelWidth = landscape ? LANDSCAPE_WIDTH : PORTRAIT_WIDTH;
    this.panelHeight = landscape ? LANDSCAPE_HEIGHT : PORTRAIT_HEIGHT;
    this.faceWidth = this.panelWidth;
    this.headerHeight = 0;
    this.artY = PORTRAIT_HEADER_HEIGHT;
    const scale = PORTRAIT_WIDTH / CARD_RENDER_WIDTH;
    const region = getCardInteractionRegion(this.faceGeometry, landscape);
    this.rulesRegion.x = region.x * scale;
    this.rulesRegion.y = region.y * scale;
    this.rulesRegion.width = region.width * scale;
    this.rulesRegion.height = region.height * scale;
    if (this.scanOverlay) {
      const top = this.panelHeight * SCAN_OVERLAY_TOP_FRACTION;
      this.rulesRegion.set(
        SCAN_OVERLAY_INSET,
        top,
        this.panelWidth - SCAN_OVERLAY_INSET * 2,
        this.panelHeight - top - SCAN_OVERLAY_INSET,
      );
    }
    this.detailsHeight = this.rulesRegion.height;
    this.contentX = this.scanOverlay ? CONTENT_PAD : 4;
    this.contentWidth = Math.max(
      1,
      this.rulesRegion.width - this.contentX * 2 - (this.scanOverlay ? 0 : 4),
    );
    this.bodyTop = this.scanOverlay ? 8 : RULES_INSET;
    this.bodyHeight = Math.max(1, this.detailsHeight - this.bodyTop - RULES_INSET);
  }

  private addTypeHeading(typeLine: string): void {
    const heading = new Text({
      text: typeLine,
      style: new TextStyle({
        fontFamily: this.frame.bodyFont,
        fontSize: 14,
        fontWeight: "700",
        fill: this.frame.ink,
        wordWrap: true,
        wordWrapWidth: this.contentWidth,
      }),
    });
    heading.resolution = 2;
    heading.position.set(this.contentX, RULES_INSET);
    heading.eventMode = "none";
    this.chrome.addChild(heading);
    this.headerHeight = heading.height + RULES_INSET * 2;
    this.bodyTop = this.headerHeight + RULES_INSET;
    this.bodyHeight = Math.max(1, this.detailsHeight - this.bodyTop - RULES_INSET);
  }

  private drawFooter(
    stats: CardStatPresentation | null,
    loyalty: number | null,
    defense: number | null,
  ): void {
    this.footer.position.set(0, this.detailsHeight - STAT_BADGE_HEIGHT);
    let right = this.rulesRegion.width - CONTENT_PAD;
    if (stats) {
      right = drawRulesStatBadge(this.footer, stats, right, 3, this.frame, this.theme);
    }
    if (loyalty != null) this.drawShieldValue(loyalty, i18n._(msg`Loyalty`), right);
    else if (defense != null) this.drawShieldValue(defense, i18n._(msg`Defense`), right);
    this.footer.visible =
      this.footer.children.length > 0 && (this.scanOverlay || !this.faceTexture);
    if (this.footer.visible) {
      const bounds = this.footer.getLocalBounds();
      this.statBounds.set(
        Math.max(this.contentX, bounds.x - RULES_INSET),
        Math.max(this.bodyTop, this.footer.y + bounds.y - RULES_INSET),
        bounds.width + RULES_INSET * 2,
        bounds.height + RULES_INSET * 2,
      );
    } else this.statBounds.set(0, this.detailsHeight, 0, 0);
  }

  private drawShieldValue(value: number, label: string, right: number): void {
    const width = 36;
    const left = right - width;
    const badge = new Graphics();
    badge.poly([left, 2, right, 2, right - 3, 25, right - width / 2, 34, left + 3, 25]);
    badge.fill(hexToNum(this.frame.raised));
    badge.stroke({ color: hexToNum(this.frame.border), width: 1 });
    const valueText = new Text({
      text: String(value),
      style: textStyle(this.frame.ink, 18, "700", RULES_TITLE_FONT),
    });
    valueText.resolution = 2;
    valueText.anchor.set(0.5);
    valueText.position.set(right - width / 2, 16);
    const labelText = new Text({
      text: label,
      style: textStyle(this.frame.mutedInk, 10, "400"),
    });
    labelText.resolution = 2;
    labelText.anchor.set(1, 0.5);
    labelText.position.set(left - 8, 17);
    this.footer.addChild(badge, labelText, valueText);
  }

  private previewLayout(horizontal: boolean): PreviewLayout {
    const spec = this.spec!;
    return computePreviewLayout({
      placement: spec.placement,
      anchorRect: spec.anchor
        ? new DOMRect(spec.anchor.x, spec.anchor.y, spec.anchor.width, spec.anchor.height)
        : null,
      mouseX: spec.pointer.x,
      mouseY: spec.pointer.y,
      horizontal,
      hasPanel: !this.scanOverlay && spec.reserveSidePanel,
      panelHeight: 0,
      slot: null,
      viewportRight: this.viewportWidth,
      viewportBottom: this.viewportHeight,
      size: this.previewSize,
    });
  }

  private layoutPanel(): void {
    const spec = this.spec;
    if (!spec || this.viewportWidth <= 0 || this.viewportHeight <= 0) return;
    const previewScale =
      MAX_PREVIEW_SCALE * (spec.embedded ? 1 : IN_GAME_CARD_PREVIEW_SCALES[this.previewSize]);
    let scale: number;
    let x: number;
    let y: number;
    if (spec.slot) {
      const safe = spec.embedded ? { left: 0, right: 0, top: 0, bottom: 0 } : getSafeAreaInsets();
      const slotLeft = Math.max(safe.left, spec.slot.x);
      const slotTop = Math.max(safe.top, spec.slot.y);
      const slotWidth = Math.max(
        1,
        Math.min(spec.slot.width, this.viewportWidth - safe.right - slotLeft),
      );
      const slotHeight = Math.max(
        1,
        Math.min(spec.slot.height, this.viewportHeight - safe.bottom - slotTop),
      );
      scale = Math.min(previewScale, slotWidth / this.panelWidth, slotHeight / this.widgetHeight);
      const width = this.panelWidth * scale;
      const height = this.widgetHeight * scale;
      x = slotLeft + (slotWidth - width) / 2;
      y = slotTop + (slotHeight - height) / 2;
    } else {
      const layout = this.previewLayout(this.panelWidth === LANDSCAPE_WIDTH);
      scale = layout.cardWidth / this.panelWidth;
      x = layout.cardLeft;
      y = layout.top;
    }
    this.container.scale.set(scale);

    this.container.position.set(x, y);
    this.layoutX = this.container.x;
    this.layoutY = this.container.y;
    this.layoutScale = scale;
    this.viewControls.setParentScale(scale, scale, this.panelWidth, this.artY);
    const anchorX = spec.anchor?.x ?? spec.pointer.x;
    const anchorY = spec.anchor?.y ?? spec.pointer.y;
    const anchorWidth = spec.anchor?.width ?? 0;
    const anchorHeight = spec.anchor?.height ?? 0;
    this.cardBounds.x = Math.min(0, this.rulesRegion.x);
    this.cardBounds.width = Math.max(this.panelWidth, this.rulesRegion.right) - this.cardBounds.x;
    this.cardBounds.height = this.widgetHeight;
    this.anchorBounds.x = (anchorX - this.container.x) / scale;
    this.anchorBounds.y = (anchorY - this.container.y) / scale;
    this.anchorBounds.width = anchorWidth / scale;
    this.anchorBounds.height = anchorHeight / scale;
    this.layoutDetails();
  }

  private layoutDetails(): void {
    const height = this.detailsHeight;
    this.detailsContainer.position.set(this.rulesRegion.x, this.rulesRegion.y);
    this.background.clear();
    if (this.scanOverlay) {
      this.background
        .roundRect(0, 0, this.rulesRegion.width, height, RULES_CARD_CONSTRAINTS.radius)
        .fill({ color: hexToNum(this.frame.paper), alpha: SCAN_OVERLAY_OPACITY });
    } else if (!this.faceGeometry?.rules.length) {
      this.background.rect(0, 0, this.rulesRegion.width, height).fill(hexToNum(this.frame.paper));
    }
    this.bodyMask.clear();
    const clearHeight = this.footer.visible
      ? Math.max(0, Math.min(this.bodyHeight, this.statBounds.y - this.bodyTop))
      : this.bodyHeight;
    this.bodyMask.rect(this.contentX, this.bodyTop, this.contentWidth, clearHeight);
    if (clearHeight < this.bodyHeight) {
      this.bodyMask.rect(
        this.contentX,
        this.bodyTop + clearHeight,
        Math.max(0, this.statBounds.x - this.contentX),
        this.bodyHeight - clearHeight,
      );
    }
    this.bodyMask.fill(hexToNum(this.frame.paper));
    this.bodyScroller.hitArea = {
      contains: (x, y) =>
        x >= 0 &&
        x <= this.contentWidth &&
        y >= 0 &&
        y <= this.bodyHeight &&
        (!this.footer.visible ||
          x + this.contentX < this.statBounds.x ||
          y + this.bodyTop < this.statBounds.y),
    };
    this.foilRulesExclusion.copyFrom(this.rulesRegion);
    this.foilRulesExclusion.x -= this.foilSurface.x;
    this.foilRulesExclusion.y -= this.foilSurface.y;
    this.foil?.setExclusion(this.foilRulesExclusion);
    this.setScroll(this.scrollOffset);
  }

  private animateIn(fromHidden: boolean): void {
    const spec = this.spec;
    if (!spec) return;
    this.container.visible = true;
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    this.armInteraction();
    if (!fromHidden || !animationsEnabled() || prefersReducedMotion()) {
      this.container.alpha = 1;
      return;
    }

    const finalX = this.container.x;
    const finalY = this.container.y;
    const finalScale = this.container.scale.x;
    const anchorCenterX = spec.anchor ? spec.anchor.x + spec.anchor.width / 2 : spec.pointer.x;
    const anchorCenterY = spec.anchor ? spec.anchor.y + spec.anchor.height / 2 : spec.pointer.y;
    const startScale = spec.anchor
      ? Math.max(0.25, Math.min(0.85, spec.anchor.width / this.panelWidth))
      : 0.5;
    gsap.fromTo(
      this.container,
      { x: anchorCenterX, y: anchorCenterY, alpha: 0 },
      {
        x: finalX,
        y: finalY,
        alpha: 1,
        duration: PREVIEW_TIMING.enterMs / 1000,
        ease: "power3.out",
      },
    );
    gsap.fromTo(
      this.container.scale,
      { x: startScale, y: startScale },
      {
        x: finalScale,
        y: finalScale,
        duration: PREVIEW_TIMING.enterMs / 1000,
        ease: "power3.out",
      },
    );
  }

  private showImmediately(): void {
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    if (this.interactionTimer != null) {
      window.clearTimeout(this.interactionTimer);
      this.interactionTimer = null;
    }
    this.container.visible = true;
    this.container.alpha = 1;
    this.interactiveReady = true;
    this.callbacks.onInteractionReady();
  }

  private animateOut(): void {
    const spec = this.spec;
    this.foil?.setEnabled(false);
    this.interactiveReady = false;
    if (!spec || !animationsEnabled() || prefersReducedMotion()) {
      this.container.visible = false;
      return;
    }
    const anchorCenterX = spec.anchor ? spec.anchor.x + spec.anchor.width / 2 : spec.pointer.x;
    const anchorCenterY = spec.anchor ? spec.anchor.y + spec.anchor.height / 2 : spec.pointer.y;
    gsap.to(this.container, {
      x: anchorCenterX,
      y: anchorCenterY,
      alpha: 0,
      duration: PREVIEW_TIMING.exitMs / 1000,
      ease: "power2.in",
    });
    gsap.to(this.container.scale, {
      x: Math.max(0.25, this.container.scale.x * 0.55),
      y: Math.max(0.25, this.container.scale.y * 0.55),
      duration: PREVIEW_TIMING.exitMs / 1000,
      ease: "power2.in",
    });
  }

  private armInteraction(): void {
    this.interactiveReady = false;
    if (this.interactionTimer != null) window.clearTimeout(this.interactionTimer);
    this.interactionTimer = window.setTimeout(() => {
      this.interactionTimer = null;
      if (this.spec?.phase === "open" && !this.spec.suppressed) {
        this.interactiveReady = true;
        this.callbacks.onInteractionReady();
      }
    }, PREVIEW_TIMING.enterMs + ENTRY_INTERACTION_PAD_MS);
  }

  private setScroll(offset: number): void {
    const maxScroll = Math.max(0, this.contentHeight - this.bodyHeight);
    const previousOffset = this.scrollOffset;
    this.scrollOffset = Math.max(0, Math.min(offset, maxScroll));
    this.bodyContent.y = -this.scrollOffset;
    this.drawScrollAffordance(maxScroll);
    if (this.scrollOffset !== previousOffset) {
      this.bodyTapCancelled = true;
      this.actions.cancelPress();
      this.controls.cancelPress();
      this.callbacks.onRenderRequested();
    }
  }

  private drawScrollAffordance(maxScroll: number): void {
    this.scrollTrack.clear();
    this.scrollThumb.clear();
    if (!this.bodyScroller.visible || maxScroll <= 0 || this.bodyHeight <= 0) return;
    const trackX = this.rulesRegion.width - 3;
    const trackY = this.bodyTop + 5;
    const trackHeight = Math.max(12, this.bodyHeight - 10);
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(28, trackHeight * (this.bodyHeight / this.contentHeight)),
    );
    const thumbTravel = Math.max(0, trackHeight - thumbHeight);
    const thumbY = trackY + thumbTravel * (this.scrollOffset / maxScroll);
    this.scrollTrack.roundRect(trackX, trackY, 2, trackHeight, 1);
    this.scrollTrack.fill({
      color: hexToNum(this.frame.ink),
      alpha: 0.12,
    });
    this.scrollThumb.roundRect(trackX - 1, thumbY, 4, thumbHeight, 2);
    this.scrollThumb.fill({
      color: hexToNum(this.frame.mutedInk),
      alpha: 0.85,
    });
  }

  private async loadCardInfo(): Promise<void> {
    const spec = this.spec;
    if (!spec) return;
    const generation = ++this.cardInfoGeneration;
    if (spec.card.isFaceDown || !spec.card.identity.name) {
      this.scryfallInfo = null;
      return;
    }
    try {
      const identity = spec.card.identity.isToken
        ? previewDeckCard(spec.card).identity
        : spec.card.identity;
      const lookup = {
        name: identity.name,
        setCode: identity.setCode || undefined,
        collectorNumber: identity.cardNumber || undefined,
      };
      const getCard = useScryfallStore.getState().getCard;
      const entry = await getCard(lookup).catch((error: unknown) => {
        if (!lookup.setCode || !lookup.collectorNumber) throw error;
        return getCard({ name: lookup.name });
      });
      if (!this.spec || generation !== this.cardInfoGeneration) return;
      this.scryfallInfo = entry.info;
      this.rebuild();
      this.callbacks.onRenderRequested();
    } catch {
      if (generation === this.cardInfoGeneration) this.scryfallInfo = null;
    }
  }

  private async loadFace(): Promise<void> {
    const spec = this.spec;
    if (!spec) return;
    this.renderAbort?.abort();
    const controller = new AbortController();
    this.renderAbort = controller;
    const generation = ++this.artGeneration;
    if (!this.imageReady) {
      this.renderState = "loading";
      this.faceSprite.label = "card-glint-loading";
    }
    const hidden = spec.card.isFaceDown || !spec.card.identity.name;
    const deckCard = hidden ? undefined : previewDeckCard(spec.card);
    if (!hidden && this.faceSprite.texture === Texture.EMPTY && deckCard) {
      void useScryfallStore
        .getState()
        .getCardTexture(deckCard, "full", spec.showBackFace ? 1 : 0)
        .then((texture) => {
          if (
            controller.signal.aborted ||
            generation !== this.artGeneration ||
            this.renderState === "ready"
          )
            return;
          this.faceSprite.texture = texture;
          this.rebuild();
          this.callbacks.onRenderRequested();
        })
        .catch(() => undefined);
    }
    try {
      const rendered = hidden
        ? null
        : await renderRulesCard(
            {
              card: spec.card,
              deckCard,
              faceIndex: spec.showBackFace ? 1 : 0,
            },
            controller.signal,
          );
      const canvas = rendered?.rulesBackground ?? rendered?.face ?? null;
      if (canvas && this.faceTexture?.source.resource === canvas) return;
      const geometry = canvas ? getCardRenderGeometry(canvas) : undefined;
      const cardBack = hidden ? await loadCardBack() : null;
      if (
        controller.signal.aborted ||
        generation !== this.artGeneration ||
        this.container.destroyed
      )
        return;
      const texture = canvas ? createGeneratedCardTexture(canvas) : cardBack!;
      const previous = this.faceTexture;
      this.foil?.setTexture(null);
      this.faceGeometry = geometry;
      this.preserveArtwork = false;
      this.faceTexture = hidden ? null : texture;
      this.faceSprite.texture = texture;
      this.renderState = "ready";
      this.faceSprite.label = hidden ? "card-back" : "card-glint-ready";
      this.rebuild();
      this.callbacks.onRenderRequested();
      previous?.destroy(true);
    } catch (cause: unknown) {
      if (
        controller.signal.aborted ||
        generation !== this.artGeneration ||
        this.container.destroyed
      )
        return;
      this.renderState = "error";
      this.preserveArtwork =
        cause instanceof CardArtworkError ||
        (!!this.scryfallInfo && hasIntegratedArtwork(this.scryfallInfo));
      this.faceSprite.label = "card-glint-original";
      this.faceGeometry = undefined;
      if (this.faceTexture) this.clearFaceTexture();
      this.rebuild();
      this.callbacks.onRenderRequested();
      if (deckCard) {
        const texture = await useScryfallStore
          .getState()
          .getCardTexture(deckCard, "full", spec.showBackFace ? 1 : 0)
          .catch(() => Texture.EMPTY);
        if (
          controller.signal.aborted ||
          generation !== this.artGeneration ||
          this.container.destroyed
        )
          return;
        this.faceSprite.texture = texture;
        this.rebuild();
        this.callbacks.onRenderRequested();
      }
    }
  }

  private clearFaceTexture(): void {
    this.faceSprite.texture = Texture.EMPTY;
    this.foil?.setTexture(null);
    this.liveHighlight.setSource(null);
    this.callbacks.onRenderRequested();
    this.faceTexture?.destroy(true);
    this.faceTexture = null;
  }

  private fitFace(): void {
    const texture = this.faceSprite.texture;
    this.fallbackFace.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.fallbackFace.visible = texture === Texture.EMPTY;
    if (texture === Texture.EMPTY && this.spec) {
      const background = new Graphics()
        .roundRect(
          0,
          0,
          this.faceWidth,
          this.panelHeight,
          rulesCardRadius(this.faceWidth, this.panelHeight),
        )
        .fill(hexToNum(this.frame.paper));
      if (!this.scanOverlay) background.stroke({ color: hexToNum(this.frame.border), width: 2 });
      this.fallbackFace.addChild(background);
      const style = textStyle(this.frame.ink, 22, "700", RULES_TITLE_FONT);
      style.wordWrap = true;
      style.wordWrapWidth = this.faceWidth - CONTENT_PAD * 2;
      const title = new Text({
        text: this.spec.card.isFaceDown ? i18n._(msg`Face down`) : this.spec.card.identity.name,
        style,
      });
      title.position.set(CONTENT_PAD, CONTENT_PAD);
      this.fallbackFace.addChild(title);
    }
    if (texture === Texture.EMPTY) {
      this.liveHighlight.setSource(null);
      return;
    }
    this.faceSprite.anchor.set(0.5);
    this.faceSprite.position.set(this.faceWidth / 2, this.panelHeight / 2);
    const landscape = this.panelWidth > this.panelHeight;
    const rotate = landscape && texture.width < texture.height;
    this.faceSprite.rotation = rotate ? Math.PI / 2 : 0;
    const width = rotate ? texture.height : texture.width;
    const height = rotate ? texture.width : texture.height;
    this.faceSprite.scale.set(Math.min(this.faceWidth / width, this.panelHeight / height));
    const faceWidth = rotate ? this.faceSprite.height : this.faceSprite.width;
    const faceHeight = rotate ? this.faceSprite.width : this.faceSprite.height;
    this.faceMask
      .clear()
      .roundRect(
        (this.faceWidth - faceWidth) / 2,
        (this.panelHeight - faceHeight) / 2,
        faceWidth,
        faceHeight,
        rulesCardRadius(faceWidth, faceHeight),
      )
      .fill(hexToNum(this.theme.gameTheme.canvas.shadow));
    this.liveHighlight.setSource(
      this.renderState === "ready" && !this.spec?.card.isFaceDown && this.spec?.card.identity.name
        ? this.faceSprite
        : null,
    );
  }

  private hide(preserveHover = false): void {
    this.foil?.setEnabled(false);
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    this.highlightedEffectTween?.kill();
    this.highlightedEffectTween = null;
    if (this.interactionTimer != null) {
      window.clearTimeout(this.interactionTimer);
      this.interactionTimer = null;
    }
    this.interactiveReady = false;
    if (!preserveHover && !this.spec) this.clearHover();
    this.dragPointerId = null;
    this.actions.reset();
    this.controls.reset();
    this.container.visible = false;
    this.container.alpha = 0;
  }

  destroy(): void {
    this.unsubscribePreferences();
    this.clearHover();
    this.hide();
    this.artGeneration += 1;
    this.cardInfoGeneration += 1;
    this.renderAbort?.abort();
    this.unsubscribeLocale();
    this.clearFaceTexture();
    this.liveHighlight.destroy();
    this.actions.destroy();
    this.controls.destroy();
    this.container.destroy({ children: true });
  }
}
