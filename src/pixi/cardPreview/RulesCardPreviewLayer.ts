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
import type { PreviewPhase } from "@/lib/cardPreview";
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
import { usePreferencesStore, type RulesPreviewSectionId } from "@/stores/usePreferencesStore";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
import {
  RulesPreviewSectionHeader,
  PREVIEW_SECTION_HEADER_HEIGHT,
} from "./RulesPreviewSectionHeader";
import { parseManaCost } from "@/pixi/manaSymbols";
import {
  CARD_PREVIEW_EDGE_PAD as EDGE_PAD,
  computePreviewLayout,
} from "@/components/game/cardPreviewLayout";
import { GAME_CARD_SIZES } from "@/components/game/game.constants";
import {
  getMseCardRules,
  MSE_CARD_WIDTH,
  MSE_CARD_HEIGHT,
  renderMseCard,
  type MseCardArtwork,
} from "@/lib/mseCardRenderer";
import { createMseCardTexture } from "@/pixi/mseCardTexture";
import { CardFoil } from "@/pixi/effects/CardFoil";

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
  onFlip: () => void;
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
const FOOTER_HEIGHT = 40;
const FRAME_BOTTOM_PAD = 16;
const FALLBACK_DETAILS_HEIGHT = 146;
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
  private detailsOpen = false;
  private detailsHeight = PORTRAIT_HEIGHT;
  private faceSprite = new Sprite(Texture.EMPTY);
  private rulesRegions: readonly MseCardArtwork[] = [];
  private rulesRegion = new Rectangle();
  private fallbackFace = new Container();
  private faceTexture: Texture | null = null;
  private rulesBackground = new Sprite(Texture.EMPTY);
  private rulesBackgroundMask = new Graphics();
  private rulesBackgroundTexture: Texture | null = null;
  private rulesBackgroundAbort: AbortController | null = null;
  private foil: CardFoil | null = null;
  private renderAbort: AbortController | null = null;
  private unsubscribeLocale: () => void;
  private renderState: "loading" | "ready" | "error" = "loading";
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
  private scrollFade = new Graphics();
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
  private headerHeight = PREVIEW_SECTION_HEADER_HEIGHT;
  private bodyTop = PREVIEW_SECTION_HEADER_HEIGHT + 8;
  private bodyHeight = 0;
  private footerHeight = FOOTER_HEIGHT;
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
    this.rulesBackground.eventMode = "none";
    this.rulesBackground.mask = this.rulesBackgroundMask;
    this.fieldFace.addChild(this.faceSprite, this.fallbackFace);
    this.detailsContainer.addChild(
      this.background,
      this.chrome,
      this.bodyScroller,
      this.bodyMask,
      this.footer,
      this.scrollTrack,
      this.scrollThumb,
      this.scrollFade,
    );
    this.cardContainer.addChild(this.fieldFace, this.rulesBackground, this.rulesBackgroundMask);
    this.container.addChild(this.cardContainer, this.detailsContainer, this.viewControls);
  }
  get artworkTop(): number {
    return this.container.y + this.artY * this.container.scale.y;
  }
  get imageReady(): boolean {
    return this.faceSprite.texture !== Texture.EMPTY;
  }

  setCallbacks(callbacks: RulesCardPreviewCallbacks): void {
    this.callbacks = callbacks;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.viewControls.setTheme(theme);
    if (this.spec) this.rebuild();
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
      this.rulesBackgroundAbort?.abort();
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
    if (
      spec.actions.length === 0 &&
      (!previous || previous.actions.length > 0 || previous.card.id !== spec.card.id)
    ) {
      usePreferencesStore.getState().setRulesPreviewSectionCollapsed("rules", false);
    }
    if (cardChanged || embeddedChanged || faceChanged) this.detailsOpen = false;
    if (highlightChanged && spec.highlightedEffect) this.detailsOpen = true;
    this.displayedBackFace = spec.showBackFace;
    if (lookupChanged || faceChanged || visibilityChanged) {
      this.faceSprite.texture = Texture.EMPTY;
      this.faceTexture?.destroy(true);
      this.faceTexture = null;
      this.rulesRegions = [];
      this.clearRulesBackground();
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
    if (!this.revealActions()) return;
    this.actions.focusAction(delta);
    const row = this.actions.focusedActionBounds;
    if (row) this.scrollIntoView(this.actions.y + row.top, row.height);
    this.callbacks.onRenderRequested();
  }

  activateFocusedAction(): void {
    if (this.detailsOpen) {
      this.focusAction(0);
      return;
    }
    this.actions.activateFocusedAction();
    this.callbacks.onRenderRequested();
  }

  activateShortcut(shortcut: number): boolean {
    if (!this.revealActions()) return false;
    return this.actions.activateShortcut(shortcut);
  }

  private revealActions(): boolean {
    if (!this.spec?.actions.length) return false;
    if (this.detailsOpen) {
      this.detailsOpen = false;
      this.rebuild();
    }
    return true;
  }

  private scrollIntoView(top: number, height: number): void {
    if (top < this.scrollOffset) this.setScroll(top);
    else if (top + height > this.scrollOffset + this.bodyHeight) {
      this.setScroll(height > this.bodyHeight ? top : top + height - this.bodyHeight);
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
    if (!this.detailsOpen && !this.spec?.actions.length) {
      this.detailsOpen = true;
      this.rebuild();
    }
    const transform = this.bodyScroller.worldTransform;
    const scale = Math.hypot(transform.c, transform.d);
    const unit =
      mode === 1 ? ORACLE_LINE_HEIGHT : mode === 2 ? this.bodyHeight : scale > 0 ? 1 / scale : 0;
    this.setScroll(this.scrollOffset + delta * unit);
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
    const hasFooterValue = display.stats || display.loyalty != null || display.defense != null;
    this.configureGeometry(landscape, hasFooterValue ? FOOTER_HEIGHT : FRAME_BOTTOM_PAD);
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
      this.rulesBackgroundTexture ? this.rulesRegions[0] : undefined,
    );

    const showingBody =
      this.detailsOpen || indexedActions.length > 0 || this.renderState === "error";
    if (!display.faceless && this.renderState === "ready" && !this.rulesBackgroundAbort) {
      void this.loadRulesBackground();
    }
    const detailsHeader = new RulesPreviewSectionHeader({
      title:
        this.renderState === "error"
          ? i18n._(msg`Generated unavailable · details`)
          : indexedActions.length > 0
            ? this.detailsOpen
              ? i18n._(msg`Show actions · ${indexedActions.length}`)
              : i18n._(msg`Rules & details · ${indexedActions.length} actions`)
            : i18n._(msg`Rules & details`),
      width: this.rulesRegion.width,
      height: this.headerHeight,
      collapsed: !this.detailsOpen,
      frame: this.frame,
      onToggle: () => {
        this.detailsOpen = !this.detailsOpen;
        this.scrollOffset = 0;
        this.rebuild();
        this.callbacks.onRenderRequested();
      },
      onRenderRequested: () => this.callbacks.onRenderRequested(),
    });
    detailsHeader.on("pointerdown", (event: FederatedPointerEvent) => event.stopPropagation());
    this.chrome.addChild(detailsHeader);
    this.detailsContainer.visible = !display.faceless;
    this.bodyScroller.visible = showingBody;
    this.footer.visible = showingBody;
    this.fitFace();
    const showFoil = !spec.embedded && !display.faceless && spec.card.foil;
    if (showFoil) {
      if (!this.foil) {
        this.foil = new CardFoil(() => this.callbacks.onRenderRequested());
        this.container.addChildAt(this.foil, 1);
      }
      this.foil.setSurface(
        this.panelWidth,
        this.panelHeight,
        rulesCardRadius(this.panelWidth, this.panelHeight),
        this.theme,
      );
    }
    this.foil?.setEnabled(showFoil);
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
    if (indexedActions.length > 0 && !this.detailsOpen) {
      if (display.otherFace) {
        y = this.addStaticAbilityRow(i18n._(msg`Actions apply to the current face.`), y);
      }
      this.actions.visible = true;
      this.actions.position.set(0, y);
      this.bodyContent.addChild(this.actions);
      y += this.actions.panelHeight + 4;
    }
    const showDetails = this.detailsOpen || indexedActions.length === 0;
    if (
      showDetails &&
      (display.keywords.length > 0 || display.costs.length > 0 || visibleCounters.length > 0)
    ) {
      y = this.addSectionHeader(
        "details",
        i18n._(msg`Keywords, costs & counters`),
        y,
        this.bodyContent,
        display.keywords.length > 0 ? this.theme.gameTheme.cardRing : undefined,
      );
      if (!this.isCollapsed("details")) {
        if (display.keywords.length > 0) y = this.addKeywordChips(display.keywords, y);
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
              y + 6,
            ) + 8;
        }
      }
    }
    if (showDetails && progression) {
      y = this.addSectionHeader("progression", i18n._(msg`Progression`), y);
      if (!this.isCollapsed("progression")) {
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
    }
    const rulesEntries = display.sections.map((section) =>
      rulesTextEntries(section.rulesText, progression, section.canonicalRulesText),
    );
    if (showDetails && display.faceless) {
      y = this.addStaticAbilityRow(i18n._(msg`Card identity and rules are hidden.`), y);
    } else if (showDetails && rulesEntries.some((entries) => entries.length > 0)) {
      y = this.addSectionHeader("rules", i18n._(msg`Rules text`), y);
      if (!this.isCollapsed("rules")) {
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
    }
    if (showDetails && display.sections.some((section) => section.flavorText)) {
      y = this.addSectionHeader("flavor", i18n._(msg`Flavor text`), y);
      if (!this.isCollapsed("flavor")) {
        for (const section of display.sections) {
          if (!section.flavorText) continue;
          if (display.multipart) {
            y = this.addFaceHeading(section.name, section.manaCost, section.typeLine, y);
          }
          y = this.addFlavorText(section.flavorText, y);
        }
      }
    }

    const controls: Array<{ label: string; activate: () => void }> = [];
    if (display.flippable && !spec.embedded) {
      controls.push({
        label: display.faceIndex === 0 ? i18n._(msg`Flip back · F`) : i18n._(msg`Flip front · F`),
        activate: () => this.callbacks.onFlip(),
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
    this.contentHeight = y + 8;
    this.bodyScroller.hitArea = new Rectangle(0, 0, this.contentWidth, this.bodyHeight);
    this.drawFooter(display.stats, display.loyalty, display.defense);
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

  private isCollapsed(id: RulesPreviewSectionId): boolean {
    return usePreferencesStore.getState().collapsedRulesPreviewSections.includes(id);
  }

  private toggleSection(id: RulesPreviewSectionId): void {
    usePreferencesStore.getState().setRulesPreviewSectionCollapsed(id, !this.isCollapsed(id));
    this.rebuild();
    this.callbacks.onRenderRequested();
  }

  private addSectionHeader(
    id: RulesPreviewSectionId,
    title: string,
    y: number,
    parent = this.bodyContent,
    collapsedAccent?: string,
  ): number {
    const header = new RulesPreviewSectionHeader({
      title,
      width: this.contentWidth,
      collapsed: this.isCollapsed(id),
      frame: this.frame,
      collapsedAccent,
      onToggle: () => this.toggleSection(id),
      onRenderRequested: () => this.callbacks.onRenderRequested(),
    });
    header.label = id;
    header.position.set(0, y);
    parent.addChild(header);
    return y + PREVIEW_SECTION_HEADER_HEIGHT + 4;
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

  private configureGeometry(landscape: boolean, footerHeight: number): void {
    this.footerHeight = this.faceTexture ? 0 : footerHeight;
    this.panelWidth = landscape ? LANDSCAPE_WIDTH : PORTRAIT_WIDTH;
    this.panelHeight = landscape ? LANDSCAPE_HEIGHT : PORTRAIT_HEIGHT;
    this.faceWidth = this.panelWidth;
    this.headerHeight = PREVIEW_SECTION_HEADER_HEIGHT;
    this.artY = PORTRAIT_HEADER_HEIGHT;
    const scale = PORTRAIT_WIDTH / MSE_CARD_WIDTH;
    const regions = this.rulesRegions.map((region) =>
      landscape
        ? new Rectangle(
            (MSE_CARD_HEIGHT - region.y - region.height) * scale,
            region.x * scale,
            region.height * scale,
            region.width * scale,
          )
        : new Rectangle(
            region.x * scale,
            region.y * scale,
            region.width * scale,
            region.height * scale,
          ),
    );
    const groups: Rectangle[] = [];
    for (const region of regions.sort((a, b) => a.y - b.y)) {
      const group = groups.find(
        (candidate) =>
          Math.abs(candidate.x - region.x) < 16 &&
          Math.abs(candidate.width - region.width) < 32 &&
          region.y <= candidate.bottom + 24,
      );
      if (group) {
        const right = Math.max(group.right, region.right);
        const bottom = Math.max(group.bottom, region.bottom);
        group.x = Math.min(group.x, region.x);
        group.y = Math.min(group.y, region.y);
        group.width = right - group.x;
        group.height = bottom - group.y;
      } else groups.push(region);
    }
    const measured = groups.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    this.rulesRegion.copyFrom(
      measured ??
        (landscape
          ? new Rectangle(264, 74, 214, 250)
          : new Rectangle(24, 326, 312, FALLBACK_DETAILS_HEIGHT)),
    );
    if (measured && !landscape && this.faceTexture && footerHeight === FOOTER_HEIGHT) {
      this.rulesRegion.height = Math.min(
        this.rulesRegion.height,
        this.panelHeight - FOOTER_HEIGHT - this.rulesRegion.y,
      );
    }
    this.detailsHeight = this.rulesRegion.height;
    this.headerHeight = Math.min(PREVIEW_SECTION_HEADER_HEIGHT, this.detailsHeight / 3);
    this.contentX = 4;
    this.contentWidth = Math.max(1, this.rulesRegion.width - this.contentX * 2 - 4);
    this.bodyTop = this.headerHeight;
    this.bodyHeight = Math.max(1, this.detailsHeight - this.bodyTop - this.footerHeight);
  }

  private drawFooter(
    stats: CardStatPresentation | null,
    loyalty: number | null,
    defense: number | null,
  ): void {
    this.footer.position.set(0, this.detailsHeight - this.footerHeight);
    let right = this.rulesRegion.width - CONTENT_PAD;
    if (stats) {
      right = drawRulesStatBadge(this.footer, stats, right, 3, this.frame, this.theme);
    }
    if (loyalty != null) this.drawShieldValue(loyalty, i18n._(msg`Loyalty`), right);
    else if (defense != null) this.drawShieldValue(defense, i18n._(msg`Defense`), right);
    if (stats?.damage) {
      const damage = new Text({
        text: i18n._(msg`${stats.damage} damage`),
        style: textStyle(this.frame.ink, 11, "700"),
      });
      damage.resolution = 2;
      const badge = new Graphics();
      badge.roundRect(CONTENT_PAD, 7, damage.width + 16, 22, 5);
      badge.fill(hexToNum(this.frame.paper));
      badge.stroke({ color: hexToNum(this.theme.gameTheme.pt.lethal), width: 2 });
      damage.position.set(CONTENT_PAD + 8, 11);
      this.footer.addChild(badge, damage);
    }
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

  private layoutPanel(): void {
    const spec = this.spec;
    if (!spec || this.viewportWidth <= 0 || this.viewportHeight <= 0) return;
    let scale: number;
    let x: number;
    let y: number;
    if (spec.slot) {
      scale = Math.min(
        MAX_PREVIEW_SCALE,
        spec.slot.width / this.panelWidth,
        spec.slot.height / this.widgetHeight,
      );
      const width = this.panelWidth * scale;
      const height = this.widgetHeight * scale;
      x = spec.slot.x + (spec.slot.width - width) / 2;
      y = spec.slot.y + (spec.slot.height - height) / 2;
    } else {
      const anchorRect = spec.anchor
        ? new DOMRect(spec.anchor.x, spec.anchor.y, spec.anchor.width, spec.anchor.height)
        : null;
      const layout = computePreviewLayout({
        placement: spec.placement,
        anchorRect,
        mouseX: spec.pointer.x,
        mouseY: spec.pointer.y,
        horizontal: this.panelWidth === LANDSCAPE_WIDTH,
        hasPanel: spec.reserveSidePanel,
        panelHeight: 0,
        slot: null,
        viewportRight: this.viewportWidth,
        viewportBottom: this.viewportHeight,
      });
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
    this.cardBounds.x = 0;
    this.cardBounds.width = this.panelWidth;
    this.cardBounds.height = this.widgetHeight;
    this.anchorBounds.x = (anchorX - this.container.x) / scale;
    this.anchorBounds.y = (anchorY - this.container.y) / scale;
    this.anchorBounds.width = anchorWidth / scale;
    this.anchorBounds.height = anchorHeight / scale;
    this.layoutDetails();
  }

  private layoutDetails(): void {
    const expanded = this.bodyScroller.visible;
    const height = expanded ? this.detailsHeight : this.headerHeight;
    this.detailsContainer.position.set(
      this.rulesRegion.x,
      expanded ? this.rulesRegion.y : this.rulesRegion.bottom - height,
    );
    this.rulesBackground.visible = this.detailsContainer.visible && !!this.rulesBackgroundTexture;
    this.rulesBackground.anchor.copyFrom(this.faceSprite.anchor);
    this.rulesBackground.position.copyFrom(this.faceSprite.position);
    this.rulesBackground.scale.copyFrom(this.faceSprite.scale);
    this.rulesBackground.rotation = this.faceSprite.rotation;
    this.rulesBackgroundMask
      .clear()
      .rect(this.detailsContainer.x, this.detailsContainer.y, this.rulesRegion.width, height)
      .fill(hexToNum(this.frame.paper));
    this.background.clear();
    if (!this.rulesBackground.visible) {
      this.background.rect(0, 0, this.rulesRegion.width, height).fill(hexToNum(this.frame.paper));
    }
    this.bodyMask
      .clear()
      .rect(this.contentX, this.bodyTop, this.contentWidth, this.bodyHeight)
      .fill(hexToNum(this.frame.paper));
    this.bodyScroller.hitArea = new Rectangle(0, 0, this.contentWidth, this.bodyHeight);
    this.footer.y = this.detailsHeight - this.footerHeight;
    this.footer.visible = expanded && this.footerHeight > 0;
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
    this.scrollFade.clear();
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
    if (this.scrollOffset < maxScroll - 1) {
      this.scrollFade.rect(
        this.contentX,
        this.bodyTop + this.bodyHeight - 12,
        this.contentWidth,
        12,
      );
      this.scrollFade.fill({
        color: hexToNum(this.frame.textured ? this.frame.ink : this.frame.paper),
        alpha: this.frame.textured ? 0.04 : 0.45,
      });
    }
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
    this.rulesBackgroundAbort?.abort();
    this.rulesBackgroundAbort = null;
    const controller = new AbortController();
    this.renderAbort = controller;
    const generation = ++this.artGeneration;
    this.renderState = "loading";
    this.faceSprite.label = "mse-loading";
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
      const canvas = hidden
        ? null
        : await renderMseCard(
            {
              card: spec.card,
              deckCard,
              faceIndex: spec.showBackFace ? 1 : 0,
            },
            controller.signal,
          );
      const texture = canvas ? createMseCardTexture(canvas) : await loadCardBack();
      if (
        controller.signal.aborted ||
        generation !== this.artGeneration ||
        this.container.destroyed
      ) {
        if (!hidden) texture.destroy(true);
        return;
      }
      const previous = this.faceTexture;
      this.rulesRegions = canvas ? getMseCardRules(canvas) : [];
      this.faceTexture = hidden ? null : texture;
      this.faceSprite.texture = texture;
      previous?.destroy(true);
      this.renderState = "ready";
      this.faceSprite.label = hidden ? "card-back" : "mse-ready";
      this.rebuild();
      this.callbacks.onRenderRequested();
    } catch {
      if (
        controller.signal.aborted ||
        generation !== this.artGeneration ||
        this.container.destroyed
      )
        return;
      this.renderState = "error";
      this.faceSprite.label = "mse-error";
      this.clearRulesBackground();
      this.rulesRegions = [];
      if (this.faceTexture) {
        this.faceSprite.texture = Texture.EMPTY;
        this.faceTexture.destroy(true);
        this.faceTexture = null;
      }
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

  private async loadRulesBackground(): Promise<void> {
    const spec = this.spec;
    if (!spec || this.rulesRegions.length === 0) return;
    const controller = new AbortController();
    this.rulesBackgroundAbort = controller;
    const generation = this.artGeneration;
    try {
      const canvas = await renderMseCard(
        {
          card: spec.card,
          deckCard: previewDeckCard(spec.card),
          faceIndex: spec.showBackFace ? 1 : 0,
        },
        controller.signal,
        { rulesText: false },
      );
      if (
        controller.signal.aborted ||
        generation !== this.artGeneration ||
        this.container.destroyed
      )
        return;
      const texture = createMseCardTexture(canvas);
      const previous = this.rulesBackgroundTexture;
      this.rulesBackgroundTexture = texture;
      this.rulesBackground.texture = texture;
      previous?.destroy(true);
      this.rebuild();
      this.callbacks.onRenderRequested();
    } catch {
      if (!controller.signal.aborted && generation === this.artGeneration) {
        this.callbacks.onRenderRequested();
      }
    }
  }

  private clearRulesBackground(): void {
    this.rulesBackgroundAbort?.abort();
    this.rulesBackgroundAbort = null;
    this.rulesBackground.texture = Texture.EMPTY;
    this.rulesBackgroundTexture?.destroy(true);
    this.rulesBackgroundTexture = null;
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
          this.panelWidth,
          this.panelHeight,
          rulesCardRadius(this.panelWidth, this.panelHeight),
        )
        .fill(hexToNum(this.frame.paper))
        .stroke({ color: hexToNum(this.frame.border), width: 2 });
      const style = textStyle(this.frame.ink, 22, "700", RULES_TITLE_FONT);
      style.wordWrap = true;
      style.wordWrapWidth = this.panelWidth - CONTENT_PAD * 2;
      const title = new Text({
        text: this.spec.card.isFaceDown ? i18n._(msg`Face down`) : this.spec.card.identity.name,
        style,
      });
      title.position.set(CONTENT_PAD, CONTENT_PAD);
      this.fallbackFace.addChild(background, title);
    }
    if (texture === Texture.EMPTY) return;
    this.faceSprite.anchor.set(0.5);
    this.faceSprite.position.set(this.panelWidth / 2, this.panelHeight / 2);
    const landscape = this.panelWidth > this.panelHeight;
    const rotate = landscape && texture.width < texture.height;
    this.faceSprite.rotation = rotate ? Math.PI / 2 : 0;
    const width = rotate ? texture.height : texture.width;
    const height = rotate ? texture.width : texture.height;
    this.faceSprite.scale.set(Math.min(this.panelWidth / width, this.panelHeight / height));
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
    this.clearHover();
    this.hide();
    this.artGeneration += 1;
    this.cardInfoGeneration += 1;
    this.renderAbort?.abort();
    this.unsubscribeLocale();
    this.faceTexture?.destroy(true);
    this.clearRulesBackground();
    this.actions.destroy();
    this.controls.destroy();
    this.container.destroy({ children: true });
  }
}
