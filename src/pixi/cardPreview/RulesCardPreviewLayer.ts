import { UI_FONT_FAMILY } from "@/themes/typography";
import {
  Container,
  FederatedPointerEvent,
  Graphics,
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
  ROOM_DOOR_BOUNDS,
  roomDoorState,
  type CardStatPresentation,
  type CardCounterPresentation,
} from "@/components/game/cardPresentation";
import { getPreviewActionShortcut } from "@/components/game/game.utils";
import { hexToNum } from "@/pixi/colorUtils";
import { gameIconTexture } from "@/pixi/gameIconCache";
import { PixiRichText } from "@/pixi/cardPreview/PixiRichText";
import { RulesPreviewBody, RULES_PREVIEW_FONT_SIZE } from "@/pixi/cardPreview/RulesPreviewBody";
import { PixiCardRailPreview } from "@/pixi/cardPreview/PixiCardRailPreview";
import { PixiStationPreview } from "@/pixi/cardPreview/PixiStationPreview";
import { addPlaneswalkerCost } from "@/pixi/cardPreview/PixiPlaneswalkerCost";
import { specialRules } from "card-glint/magic/presentation";
import {
  activatedRulesEntries,
  localizeRulesPreviewText,
  matchRulesEntry,
  resolveRulesPreviewDisplay,
  rulesEntryMatchesStackAbility,
  rulesTextEntries,
  stackHighlightEntry,
  stationRulesPresentation,
} from "@/pixi/cardPreview/rulesCardPreviewPresentation";
import { RulesPreviewActions } from "@/pixi/cardPreview/RulesPreviewActions";
import {
  previewActionFace,
  previewOwnsAction,
  levelActionPanel,
  previewPanelActive,
  caseSectionActive,
  caseSections,
  suspendState,
} from "@/pixi/cardPreview/previewMechanics";
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
import { cardRenderInputKey, renderRulesCard } from "@/lib/cardRenderer";
import type { CardRenderRequest } from "@/lib/cardRenderSnapshot";
import {
  releaseCardRaster,
  selectCardRenderTier,
  type CardRaster,
  type CardRenderTier,
} from "@/lib/cardRenderTypes";
import { overlayResolution } from "@/pixi/overlay/overlayRuntime";
import { CardArtworkError } from "@/lib/cardRenderDecision";
import { hasIntegratedArtwork } from "@/lib/cardArtworkPrinting";
import {
  getCardRenderGeometry,
  getCardInteractionPanels,
  CARD_RENDER_WIDTH,
  type CardInteractionPanel,
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
import type { GamePreviewFlipBinding } from "@/hooks/useGamePreviewFlip";
import { PreviewFlipAnimation } from "@/pixi/cardPreview/PreviewFlipAnimation";
import type { CardLightingMode, CardPose } from "@/lib/cardLighting";

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
  flip?: GamePreviewFlipBinding;
  lighting?: CardLightingMode;
  pose?: CardPose;
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

interface IndexedPreviewAction {
  action: HandActionOption;
  index: number;
  shortcut: number;
  displayLabel: string;
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
const FLAVOR_GAP_EM = 0.75;
const ABILITY_GAP_EM = 0.4;
const PLANESWALKER_SECTION_GAP = 8;
const SECTION_GAP = 8;
const ACTIVE_SECTION_ALPHA = 0.2;
const CASE_SELF_REFERENCE = "this Case";
const ENTRY_INTERACTION_PAD_MS = 80;
const STACK_RULES_PULSE_S = 0.9;

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
  fontFamily = UI_FONT_FAMILY,
): TextStyle {
  return new TextStyle({ fill, fontSize, fontWeight, fontFamily, lineHeight: fontSize * 1.3 });
}

function oracleTextStyle(
  fill: string,
  fontSize: number,
  italic = false,
  fontFamily = RULES_BODY_FONT,
): TextStyle {
  return new TextStyle({
    fill,
    fontFamily,
    fontSize,
    fontWeight: "400",
    fontStyle: italic ? "italic" : "normal",
    lineHeight: fontSize,
  });
}

export class RulesCardPreviewLayer {
  readonly container = new Container({ isRenderGroup: true });
  private cardContainer = new Container();
  private fieldFace = new Container();
  private detailsContainer = new Container();
  private readonly roomState = new Graphics({ label: "room-door-state", eventMode: "none" });
  private faceSprite = new Sprite(Texture.EMPTY);
  private faceMask = new Graphics();
  private faceGeometry: CardRenderGeometry | undefined;
  private faceTexture: Texture | null = null;
  private foil: CardFoil | null = null;
  private readonly materialPose = { yaw: 0, pitch: 0 };
  private readonly liveHighlight: CardLiveHighlight;
  private readonly foilUvs = new Float32Array(8);
  private readonly foilSurface = new Rectangle();
  private readonly foilRulesExclusions: Rectangle[] = [];
  private readonly screenFoilExclusions: Rectangle[] = [];
  private renderAbort: AbortController | null = null;
  private faceInputKey: string | null = null;
  private completedFaceInputKey: string | null = null;
  private renderTier: CardRenderTier | undefined;
  private projectedRasterWidth = 0;
  private projectedRasterHeight = 0;
  private rasterFlipping = false;
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
  private readonly bodies: RulesPreviewBody[] = [];
  private primaryBody: RulesPreviewBody | null = null;
  private readonly scrollPositions = new Map<string, number>();
  private actions = new RulesPreviewActions();
  private extraActions: RulesPreviewActions[] = [];
  private actionPanels = new Map<
    number,
    { view: RulesPreviewActions; index: number; body: RulesPreviewBody }
  >();
  private focusedAction: number | null = null;
  private bodyPointerId: number | null = null;
  private controls = new RulesPreviewActions();
  private viewControls: HandCardControls;
  private spec: RulesCardPreviewSpec | null = null;
  // Hidden presentations keep their scene objects, but never remain interactive.
  private retainedSpec: RulesCardPreviewSpec | null = null;
  private cardContentKey: string | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private panelWidth = PORTRAIT_WIDTH;
  private panelHeight = PORTRAIT_HEIGHT;
  private widgetHeight = PORTRAIT_HEIGHT;
  private faceWidth = PORTRAIT_WIDTH;
  private artY = PORTRAIT_HEADER_HEIGHT;
  private artGeneration = 0;
  private cardInfoGeneration = 0;
  private scryfallInfo: ScryfallCard | null = null;
  private displayedBackFace = false;
  private canFlip = false;
  private interactiveReady = false;
  private interactionTimer: number | null = null;
  private pendingEntry = false;
  private readonly entrance = { progress: 1, x: 0, y: 0, scale: 1 };
  private readonly flip = new PreviewFlipAnimation(
    () => {
      this.applyEntrancePose();
      this.callbacks.onRenderRequested();
    },
    () =>
      this.imageReady &&
      this.completedFaceInputKey === this.faceInputKey &&
      this.renderState !== "loading",
  );
  private revealHighlightedEffect = false;
  private highlightedEffectTween: gsap.core.Tween | null = null;
  private highlightedRows: Container[] = [];
  private highlightedEntry: string | null = null;
  private rulesFontSize = RULES_PREVIEW_FONT_SIZE;

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
      if (state.locale === previous.locale) return;
      this.retainedSpec = null;
      this.scryfallInfo = null;
      if (!this.spec) return;
      void this.loadCardInfo();
      void this.loadFace();
    });

    const requestRender = () => this.callbacks.onRenderRequested();
    this.actions.on("pointerover", requestRender);
    this.actions.on("pointerout", requestRender);
    this.controls.on("pointerover", requestRender);
    this.controls.on("pointerout", requestRender);

    this.faceSprite.eventMode = "none";
    this.faceSprite.mask = this.faceMask;
    this.liveHighlight = new CardLiveHighlight(requestRender);
    this.fieldFace.addChild(this.faceSprite);
    this.cardContainer.addChild(this.fieldFace, this.faceMask);
    this.container.addChild(
      this.cardContainer,
      this.liveHighlight,
      this.roomState,
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
  get imageReady(): boolean {
    return (
      this.faceSprite.texture !== Texture.EMPTY &&
      (this.faceTexture !== null || this.renderState === "error")
    );
  }
  get presentationReady(): boolean {
    return this.flip.isReady();
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
  get foilSource(): Sprite {
    return this.faceSprite;
  }
  writeFoilTextureUvs(relativeTo: Container, surface: Rectangle, output: Float32Array): void {
    writeCardTextureUvs(this.faceSprite, relativeTo, surface, output);
  }
  get foilExclusions(): readonly Rectangle[] {
    return this.detailsContainer.visible ? this.screenFoilExclusions : [];
  }

  getPanelScreenBounds() {
    return this.detailsContainer.visible
      ? this.bodies.map((body) => {
          const bounds = body.clipScreenBounds.panel;
          Object.assign(body.screenBounds, {
            id: body.panel.id,
            faceIndex: body.panel.faceIndex,
            kind: body.panel.kind,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            angle: body.panel.region.angle,
          });
          return body.screenBounds;
        })
      : [];
  }

  setCallbacks(callbacks: RulesCardPreviewCallbacks): void {
    this.callbacks = callbacks;
  }

  setTheme(theme: Theme): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.retainedSpec = null;
    this.viewControls.setTheme(theme);
    if (this.spec) {
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

  setRasterProjection(width: number, height: number, flipping: boolean): void {
    this.projectedRasterWidth = width;
    this.projectedRasterHeight = height;
    this.rasterFlipping = flipping;
    if (this.spec && this.selectRasterTier() !== this.renderTier) void this.loadFace();
  }

  private selectRasterTier(): CardRenderTier {
    return selectCardRenderTier(
      this.projectedRasterWidth || this.faceWidth * this.layoutScale,
      this.projectedRasterHeight || this.panelHeight * this.layoutScale,
      overlayResolution(window.innerWidth, window.innerHeight),
      this.renderTier,
      this.rasterFlipping || !!this.spec?.flip?.closed || this.flip.scale < 1,
    );
  }

  setSpec(spec: RulesCardPreviewSpec | null, preserveHover = false): void {
    const activePrevious = this.spec;
    const previous = activePrevious ?? this.retainedSpec;
    const returning = activePrevious === null;
    if (activePrevious?.flip?.handleRef !== spec?.flip?.handleRef && activePrevious?.flip) {
      activePrevious.flip.handleRef.current = null;
    }
    this.retainedSpec = spec ? null : previous;
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
    const cardContentKey = JSON.stringify(spec.card);
    const contentChanged = !previous || this.cardContentKey !== cardContentKey;
    this.cardContentKey = cardContentKey;
    const actionsChanged =
      !previous ||
      previous.actions.length !== spec.actions.length ||
      previous.actions.some((action, index) => action !== spec.actions[index]);
    if (this.focusedAction !== null && previous) {
      const focused = previous.actions[this.focusedAction];
      const index = focused
        ? spec.actions.findIndex(
            (action) =>
              action.cardId === focused.cardId &&
              (focused.actionId !== undefined
                ? action.actionId === focused.actionId
                : action.abilityIndex === focused.abilityIndex &&
                  action.kind === focused.kind &&
                  action.label === focused.label),
          )
        : -1;
      this.focusedAction = index >= 0 ? index : null;
    }
    const embeddedChanged = previous?.embedded !== spec.embedded;
    const highlightChanged = previous?.highlightedEffect !== spec.highlightedEffect;
    this.displayedBackFace = spec.showBackFace;
    if (spec.flip) {
      spec.flip.handleRef.current = this.flip;
      if (
        spec.flip.closed &&
        (returning || !previous?.flip?.closed || faceChanged || lookupChanged)
      ) {
        this.flip.setClosed();
      }
    }
    if (lookupChanged || visibilityChanged) {
      const retainFace =
        !hidden &&
        this.faceTexture !== null &&
        this.renderState === "ready" &&
        this.completedFaceInputKey ===
          JSON.stringify([
            cardRenderInputKey({
              card: spec.card,
              deckCard: previewDeckCard(spec.card),
              faceIndex: spec.showBackFace ? 1 : 0,
            }),
            this.selectRasterTier(),
          ]);
      if (!retainFace) {
        this.clearFaceTexture();
        this.faceGeometry = undefined;
        this.preserveArtwork = false;
      }
    }
    const previousInfo = this.scryfallInfo;
    if (lookupChanged || visibilityChanged || returning) {
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
      this.scrollPositions.clear();
      this.bodies.forEach((body) => {
        body.scrollOffset = 0;
        body.tapCancelled = true;
      });
      this.actions.reset();
    }
    if (lookupChanged || faceChanged || visibilityChanged || highlightChanged) {
      this.revealHighlightedEffect = !!spec.highlightedEffect;
    }
    const previousFaceInputKey = this.faceInputKey;
    if (
      contentChanged ||
      this.scryfallInfo !== previousInfo ||
      this.faceInputKey !== previousFaceInputKey ||
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
    if (contentChanged || faceChanged || visibilityChanged || returning)
      void this.loadFace(returning && !hidden);

    if (spec.suppressed) {
      this.hide();
      return;
    }

    this.foil?.setEnabled(!spec.embedded && !hidden && this.imageReady);
    this.applyLightingPose();
    this.startHighlightedEffect();

    if (
      !previous ||
      returning ||
      previous.phase !== spec.phase ||
      previous.suppressed ||
      lookupChanged ||
      faceChanged ||
      visibilityChanged
    ) {
      if (spec.phase === "closing") {
        if (spec.slot) this.hide();
        else this.animateOut();
      } else if (spec.skipEnterAnimation || spec.slot) this.showImmediately();
      else this.animateIn(returning);
    } else if (spec.phase === "open" && !this.pendingEntry) {
      this.container.visible = true;
    }
    if (this.flip.isReady()) spec.flip?.onReady();
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
    const indexes = [...this.actionPanels.keys()].sort((left, right) => left - right);
    const count = indexes.length;
    if (!count) return;
    const current = this.focusedAction === null ? -1 : indexes.indexOf(this.focusedAction);
    const next =
      current < 0
        ? delta < 0
          ? count - 1
          : 0
        : (((current + Math.trunc(delta)) % count) + count) % count;
    this.focusActionAt(indexes[next]!);
  }

  focusActionAt(index: number): void {
    const entry = this.actionPanels.get(index);
    if (!entry) return;
    for (const view of [this.actions, ...this.extraActions])
      if (view !== entry.view) view.clearFocus();
    this.focusedAction = index;
    entry.view.focusActionAt(entry.index);
    const row = entry.view.focusedActionBounds;
    if (row) entry.body.scrollIntoView(entry.view.y + row.top, row.height);
    this.callbacks.onRenderRequested();
  }

  ownsAction(index: number): boolean {
    return this.actionPanels.has(index);
  }

  getActionScreenBounds(index: number) {
    if (!this.spec || this.spec.suppressed || !this.container.visible) return null;
    const entry = this.actionPanels.get(index);
    const bounds = entry?.view.getActionScreenBounds(entry.index);
    const body = entry?.body;
    if (!bounds || !body?.scroller.visible) return null;
    const clip = body.clipScreenBounds.actions;
    const x = Math.max(bounds.x, clip.x);
    const y = Math.max(bounds.y, clip.y);
    const right = Math.min(bounds.x + bounds.width, clip.right);
    const bottom = Math.min(bounds.y + bounds.height, clip.bottom);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
  }

  getCardScreenBounds() {
    const top = this.container.toGlobal({ x: 0, y: 0 });
    const bottom = this.container.toGlobal({ x: this.panelWidth, y: this.panelHeight });
    return { x: top.x, y: top.y, width: bottom.x - top.x, height: bottom.y - top.y };
  }

  activateFocusedAction(): void {
    if (!this.spec?.actions.length || this.spec.suppressed) return;
    const hovered = [this.actions, ...this.extraActions].find((view) => view.hasHoveredAction);
    if (this.focusedAction === null && !hovered) {
      this.focusAction(0);
      return;
    }
    const entry =
      this.focusedAction === null ? undefined : this.actionPanels.get(this.focusedAction);
    (
      entry?.view ??
      hovered ??
      this.actionPanels.get(0)?.view ??
      this.actions
    ).activateFocusedAction();
    this.callbacks.onRenderRequested();
  }

  activateShortcut(shortcut: number): boolean {
    if (!this.spec?.actions.length) return false;
    return [this.actions, ...this.extraActions].some((view) => view.activateShortcut(shortcut));
  }

  activatePrimaryTransform(): void {
    if (this.canFlip) this.callbacks.onFlip();
  }

  scrollBy(delta: number, mode: number, x: number, y: number): void {
    const body = this.bodies.find((candidate) => candidate.containsScreen(x, y));
    if (!body) return;
    this.revealHighlightedEffect = false;
    body.scrollBy(delta, mode);
  }

  private drawScanManaCost(body: RulesPreviewBody, cost: string): void {
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
    const x = this.panelWidth - CONTENT_PAD - width - body.region.x;
    const y = CONTENT_PAD - body.region.y;
    const background = new Graphics()
      .roundRect(x, y, width, height, RULES_CARD_CONSTRAINTS.radius)
      .fill({ color: hexToNum(this.frame.paper), alpha: SCAN_OVERLAY_OPACITY });
    mana.position.set(x + SCAN_COST_PADDING, y + SCAN_COST_PADDING);
    background.eventMode = "none";
    mana.eventMode = "none";
    body.chrome.addChild(background, mana);
  }

  private rebuild(): void {
    const spec = this.spec;
    if (!spec || this.viewportWidth <= 0 || this.viewportHeight <= 0) return;
    this.highlightedEffectTween?.kill();
    this.highlightedEffectTween = null;
    this.highlightedRows = [];
    this.roomState.clear();
    this.fieldFace.visible =
      this.faceSprite.texture !== Texture.EMPTY && this.renderState !== "loading";
    this.actions.removeFromParent();
    for (const view of this.extraActions) view.destroy({ children: true });
    this.extraActions = [];
    this.actionPanels.clear();
    this.controls.removeFromParent();
    for (const body of this.bodies) {
      this.scrollPositions.set(body.panel.id, body.scrollOffset);
      body.destroy();
    }
    this.bodies.length = 0;
    this.primaryBody = null;

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
    const isCase = !display.otherFace && spec.card.subtypes.includes("Case");
    const isBattleCard = /\bBattle\b/.test(
      this.scryfallInfo?.card_faces?.[0]?.type_line ??
        this.scryfallInfo?.type_line ??
        presentation.typeLine,
    );
    const inlineActions = isCase || isBattleCard;
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
    const stationSection =
      !display.faceless && !display.multipart ? display.sections[0] : undefined;
    const station = stationSection
      ? stationRulesPresentation(stationSection.rulesText, stationSection.canonicalRulesText)
      : null;
    const nextClassLevel =
      progression?.rail.kind === "class" && progression.rail.current < progression.rail.max
        ? progression.rail.current + 1
        : null;
    const classLevelUpIndex = nextClassLevel
      ? spec.actions.findIndex((action) => action.levelUp === "class")
      : -1;
    const classActionIndex = classLevelUpIndex >= 0 ? classLevelUpIndex : null;
    const indexedActions: IndexedPreviewAction[] = (display.faceless ? [] : spec.actions).map(
      (action, index) => ({
        action,
        index,
        shortcut: getPreviewActionShortcut(
          index,
          classActionIndex,
          classActionIndex === null ? null : nextClassLevel,
        ),
        displayLabel: localizeRulesPreviewText(
          action.label,
          this.scryfallInfo,
          previewActionFace(action) ?? display.liveFaceIndex,
        ),
      }),
    );
    const activatedEntries = new Map<number, Set<string>>();
    if (!display.otherFace)
      for (const section of display.sections) {
        if (section.planeswalker) continue;
        const actions = indexedActions.filter(
          ({ action }) =>
            (previewActionFace(action) ?? display.liveFaceIndex) === section.faceIndex,
        );
        const entries =
          station && section === stationSection
            ? station.opening
            : rulesTextEntries(section.rulesText, progression, section.canonicalRulesText);
        const activated = activatedRulesEntries(actions, entries, (text) =>
          localizeRulesPreviewText(
            isCase
              ? text
                  .replaceAll("CARDNAME", CASE_SELF_REFERENCE)
                  .replaceAll(spec.card.identity.name, CASE_SELF_REFERENCE)
              : text,
            this.scryfallInfo,
            display.prototype ? 0 : section.faceIndex,
          ),
        );
        for (const [index, entry] of activated) actions[index]!.displayLabel = entry;
        activatedEntries.set(section.faceIndex, new Set(activated.values()));
      }
    this.highlightedEntry = stackHighlightEntry(
      spec.highlightedEffect,
      display.sections.flatMap((section) =>
        rulesTextEntries(section.rulesText, null, section.canonicalRulesText),
      ),
    );
    this.canFlip = display.flippable;
    const landscape = display.horizontal;
    const measuredPanels = this.configureGeometry(landscape, display.faceIndex);
    this.rulesFontSize = Math.max(
      RULES_PREVIEW_FONT_SIZE,
      this.scanOverlay || station
        ? 0
        : ((this.faceGeometry?.rulesFontSize ?? 0) * PORTRAIT_WIDTH) / CARD_RENDER_WIDTH,
    );
    const detailsReady = this.imageReady || this.renderState === "error";
    const panels = detailsReady ? measuredPanels : [];
    this.viewControls.setSpec(
      spec.embedded || !this.imageReady
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
    for (const panel of panels) {
      const frame = resolveRulesPreviewFrame(this.theme, panel.region, this.scanOverlay);
      const body = new RulesPreviewBody(
        panel,
        frame,
        () => this.callbacks.onRenderRequested(),
        () => {
          for (const view of [this.actions, ...this.extraActions]) view.cancelPress();
          this.controls.cancelPress();
        },
        (pointerId) => {
          this.bodyPointerId = pointerId;
          this.revealHighlightedEffect = false;
        },
      );
      body.configure(PORTRAIT_WIDTH / CARD_RENDER_WIDTH, this.scanOverlay);
      body.scrollOffset = this.scrollPositions.get(panel.id) ?? 0;
      this.bodies.push(body);
      this.detailsContainer.addChild(body.container);
    }
    this.primaryBody =
      this.bodies.find(
        (body) => body.panel.kind === "face" && body.panel.faceIndex === display.liveFaceIndex,
      ) ??
      this.bodies.find((body) => body.panel.kind === "face") ??
      this.bodies[0] ??
      null;
    this.frame = this.primaryBody?.frame ?? resolveRulesPreviewFrame(this.theme);
    this.detailsContainer.visible = !display.faceless && detailsReady;
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
      this.foil.setExclusions(this.foilRulesExclusions);
      this.writeFoilTextureUvs(this.container, this.foilSurface, this.foilUvs);
      this.foil.setTexture(this.faceSprite.texture, this.foilUvs, this.faceSprite);
      this.foil.setArtWindows(getGeneratedCardArtWindows(this.faceSprite.texture));
    }
    this.applyLightingPose();
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
    const visibleCounters =
      progression?.rail.kind === "saga"
        ? presentation.counters.filter((counter) => counter.type !== "Lore")
        : presentation.counters;
    const panelLayout = display.prototype
      ? "prototype"
      : /\bRoom\b/.test(this.scryfallInfo?.type_line ?? "")
        ? "room"
        : deckCard.layout;
    const doorState = roomDoorState(spec.card);
    if (
      panelLayout === "room" &&
      !spec.embedded &&
      display.currentFace &&
      !display.faceless &&
      detailsReady &&
      doorState !== undefined
    ) {
      const inset = 6;
      const shadow = hexToNum(this.theme.gameTheme.canvas.shadow);
      const active = hexToNum(this.theme.gameTheme.activeAction.active);
      for (let half = 0; half < ROOM_DOOR_BOUNDS.length; half++) {
        const bounds = ROOM_DOOR_BOUNDS[half]!;
        const x = bounds.x * this.faceWidth + inset;
        const width = bounds.width * this.faceWidth - inset * 2;
        const height = this.panelHeight - inset * 2;
        const unlocked = (doorState & (1 << half)) !== 0;
        this.roomState.roundRect(x, inset, width, height, RULES_CARD_CONSTRAINTS.radius);
        if (unlocked) {
          this.roomState.stroke({ color: shadow, alpha: 0.85, width: 6, alignment: 1 });
          this.roomState
            .roundRect(x, inset, width, height, RULES_CARD_CONSTRAINTS.radius)
            .stroke({ color: active, width: 3, alignment: 1 });
        } else this.roomState.fill({ color: shadow, alpha: 0.42 });
      }
    }
    for (const body of this.bodies) {
      this.frame = body.frame;
      const primary = body === this.primaryBody;
      const section = display.sections.find(
        (candidate) => candidate.faceIndex === body.panel.faceIndex,
      );
      if (this.scanOverlay && primary) {
        if (display.typeLine) this.addTypeHeading(body, display.typeLine);
        if (!display.faceless) this.drawScanManaCost(body, display.manaCost);
      }
      const progressionOpening =
        primary && progression && section
          ? rulesTextEntries(section.rulesText, progression, section.canonicalRulesText)
          : [];
      let y = this.scanOverlay ? 2 : 4;
      const ownedActions = indexedActions.filter(({ action }) => {
        if (!previewOwnsAction(action, display, isBattleCard)) return false;
        if (
          !this.scanOverlay &&
          action.kind === "ability" &&
          panels.some((panel) => panel.kind === "level")
        ) {
          const owner = levelActionPanel(action, panels, (text, faceIndex) =>
            localizeRulesPreviewText(text, this.scryfallInfo, faceIndex),
          );
          return owner === undefined ? primary : body.panel.id === owner;
        }
        const owner = previewActionFace(action);
        if (owner === undefined || this.scanOverlay) return primary;
        return (
          body ===
          (this.bodies.find((candidate) => candidate.panel.faceIndex === owner) ?? this.primaryBody)
        );
      });
      const upfrontActions = inlineActions
        ? ownedActions.filter(
            (entry) => !activatedEntries.get(body.panel.faceIndex)?.has(entry.displayLabel),
          )
        : ownedActions;
      y = this.addActionRows(body, upfrontActions, y, primary);
      if (primary) {
        if (display.keywords.length > 0)
          y = this.addKeywordChips(body, display.keywords, y) + SECTION_GAP;
        const suspended = suspendState(spec.card);
        if (suspended) y = this.addStaticAbilityRow(body, suspended, y);
        if (spec.card.isOnAdventure === true)
          y = this.addStaticAbilityRow(
            body,
            i18n._(msg`On an Adventure · available actions are listed on their spell half`),
            y,
          );
        if (body.panel.kind === "level" && display.stats)
          y = this.addStaticAbilityRow(
            body,
            i18n._(msg`Current P/T: ${display.stats.power}/${display.stats.toughness}`),
            y,
          );
        if (visibleCounters.length > 0) {
          y = this.addChips(body, visibleCounters, y + 4) + 8;
        }
        if (progression) {
          for (const text of progressionOpening) {
            y = this.addOracleAbilityRow(
              body,
              text,
              y,
              false,
              body.content,
              text.startsWith("(")
                ? oracleTextStyle(
                    this.frame.mutedInk,
                    this.rulesFontSize,
                    true,
                    this.frame.bodyFont,
                  )
                : oracleTextStyle(this.frame.ink, this.rulesFontSize, false, this.frame.bodyFont),
            );
          }
          const rail = new PixiCardRailPreview({
            state: progression.rail,
            effects: progression.effects,
            width: body.contentWidth,
            theme: this.theme,
            frame: this.frame,
            highlightedEffect: spec.highlightedEffect,
            sagaRail: body.sagaRail,
            classLevelBand: body.classLevelBand,
            sagaChapters: presentationCard.sagaChapters.map((chapter) => ({
              ...chapter,
              oracle: localizeRulesPreviewText(
                chapter.oracle,
                this.scryfallInfo,
                display.liveFaceIndex,
              ),
            })),
            onChange: () => this.callbacks.onRenderRequested(),
          });
          rail.position.set(0, y);
          body.content.addChild(rail);
          rail.markers.position.set(0, y);
          body.markerContent.addChild(rail.markers);
          this.highlightedRows.push(...rail.highlightedRows);
          if (rail.highlightedRowTop != null) body.highlightedRowTop = y + rail.highlightedRowTop;
          y += rail.contentHeight + 8;
        }
      }
      if (body.panel.kind === "level") {
        const entries = rulesTextEntries(body.panel.level?.rulesText ?? "", null);
        const replaced = new Set(
          ownedActions.flatMap(({ action }) => {
            const index = action.abilityText
              ? matchRulesEntry(
                  localizeRulesPreviewText(
                    action.abilityText,
                    this.scryfallInfo,
                    body.panel.faceIndex,
                  ),
                  entries,
                  action.cost,
                )
              : null;
            return index === null ? [] : [index];
          }),
        );
        for (const [index, entry] of entries.entries()) {
          if (replaced.has(index)) continue;
          y = this.addOracleAbilityRow(
            body,
            localizeRulesPreviewText(entry, this.scryfallInfo, body.panel.faceIndex),
            y,
            false,
          );
        }
      } else {
        const sections = this.scanOverlay ? display.sections : section ? [section] : [];
        for (const panelSection of sections) {
          const sectionTop = y;
          const entries =
            station && panelSection === stationSection
              ? station.opening
              : rulesTextEntries(
                  panelSection.rulesText,
                  primary ? progression : null,
                  panelSection.canonicalRulesText,
                );
          const caseParts = isCase
            ? caseSections(panelSection.rulesText, panelSection.canonicalRulesText)
            : [];
          for (const [entryIndex, text] of entries.entries()) {
            if (progressionOpening.includes(text)) continue;
            if (!inlineActions && activatedEntries.get(panelSection.faceIndex)?.has(text)) continue;
            if (panelSection.planeswalker && body.planeswalker && entryIndex > 0) {
              const { separator } = body.planeswalker;
              body.content.addChild(
                new Graphics()
                  .rect(
                    separator.x,
                    y - PLANESWALKER_SECTION_GAP / 2,
                    separator.width,
                    separator.height,
                  )
                  .fill({ color: hexToNum(this.frame.ink), alpha: 0.13 }),
              );
            }
            if (!inlineActions) {
              y = this.addOracleAbilityRow(body, text, y, panelSection.planeswalker);
              continue;
            }
            const top = y;
            const linkedActions = ownedActions.filter((entry) => entry.displayLabel === text);
            if (linkedActions.length > 0) y = this.addActionRows(body, linkedActions, y);
            else y = this.addOracleAbilityRow(body, text, y, panelSection.planeswalker);
            const part = caseParts.find((candidate) => candidate.text === text);
            const highlighted =
              !!spec.highlightedEffect &&
              (rulesEntryMatchesStackAbility(text, spec.highlightedEffect) ||
                text === this.highlightedEntry);
            if (part)
              this.addSectionTint(
                body,
                top,
                y - top,
                !highlighted && caseSectionActive(spec.card, part.kind) === true
                  ? this.theme.gameTheme.activeAction.active
                  : undefined,
                highlighted && linkedActions.length > 0,
              );
          }
          if (station && panelSection === stationSection) {
            const tiers = new PixiStationPreview({
              tiers: station.tiers,
              charge: display.currentFace ? (presentationCard.counters.Charge ?? 0) : null,
              width: body.contentWidth,
              fontSize: this.rulesFontSize,
              theme: this.theme,
              frame: this.frame,
              highlightedEffect: spec.highlightedEffect,
            });
            tiers.position.set(0, y);
            body.content.addChild(tiers);
            this.highlightedRows.push(...tiers.highlightedRows);
            if (tiers.highlightedRowTop !== null) {
              body.highlightedRowTop ??= y + tiers.highlightedRowTop;
            }
            y += tiers.contentHeight + SECTION_GAP;
          }
          if (panelSection.flavorText) y = this.addFlavorText(body, panelSection.flavorText, y);
          if (
            this.scanOverlay &&
            display.currentFace &&
            previewPanelActive(spec.card, { faceIndex: panelSection.faceIndex }, panelLayout) ===
              true
          )
            this.addSectionTint(
              body,
              sectionTop,
              y - sectionTop,
              this.theme.gameTheme.activeAction.active,
            );
        }
      }
      if (primary) {
        const controls: Array<{ label: string; activate: () => void }> = [];
        if (display.flippable && !spec.embedded) {
          controls.push({
            label:
              display.faceIndex === 0 ? i18n._(msg`Flip back · F`) : i18n._(msg`Flip front · F`),
            activate: () => this.callbacks.onFlip({ sticky: true }),
          });
        }
        this.controls.setContent({
          width: body.contentWidth,
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
          if (y > 0) y += SECTION_GAP;
          this.controls.position.set(0, y);
          body.content.addChild(this.controls);
          y += this.controls.panelHeight + 4;
        }
        if (display.stats?.damage)
          y = this.addStaticAbilityRow(body, i18n._(msg`${display.stats.damage} damage`), y);
        this.drawFooter(body, display.stats, display.loyalty, display.defense);
      } else {
        body.footer.visible = false;
      }
      const contentBounds = body.content.getLocalBounds();
      const contentBottom = contentBounds.y + contentBounds.height;
      const markerBounds = body.markerContent.getLocalBounds();
      body.contentHeight = Math.max(contentBottom, markerBounds.y + markerBounds.height);
      if (
        !this.scanOverlay &&
        display.currentFace &&
        previewPanelActive(spec.card, body.panel, panelLayout) === true
      )
        this.addSectionTint(
          body,
          0,
          Math.max(body.bodyHeight, body.contentHeight),
          body.panel.kind === "level"
            ? this.theme.gameTheme.counter.level
            : this.theme.gameTheme.activeAction.active,
        );
      body.layout();
      if (this.revealHighlightedEffect && body.highlightedRowTop !== null) {
        body.setScroll(Math.max(0, body.highlightedRowTop - 8));
      } else body.setScroll(body.scrollOffset);
    }
    if (detailsReady) this.revealHighlightedEffect = false;
    this.widgetHeight = this.panelHeight;
    this.startHighlightedEffect();
    this.layoutPanel();
    if (
      this.pendingEntry &&
      spec.phase === "open" &&
      !spec.suppressed &&
      (this.faceSprite.texture !== Texture.EMPTY || this.renderState === "error") &&
      this.renderState !== "loading"
    ) {
      this.animateIn(true);
    }
  }

  private startHighlightedEffect(): void {
    if (this.highlightedEffectTween || this.highlightedRows.length === 0 || !animationsEnabled())
      return;
    this.highlightedEffectTween = gsap.to(this.highlightedRows, {
      alpha: 0.72,
      duration: STACK_RULES_PULSE_S,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    });
  }

  private addKeywordChips(body: RulesPreviewBody, keywords: string[], y: number): number {
    let x = 0;
    let rowHeight = 0;
    for (const keyword of keywords) {
      const text = keyword.toUpperCase();
      if (!text) continue;
      const content = new PixiRichText();
      const textHeight = content.setContent(
        text,
        textStyle(this.theme.gameTheme.textOnTinted, 11, "700"),
        Math.max(1, body.contentWidth - 14),
        14,
        1,
      );
      const width = Math.min(body.contentWidth, content.width + 14);
      const height = Math.max(24, textHeight + 8);
      if (x > 0 && x + width > body.contentWidth) {
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
      body.content.addChild(chip);
      x += width + 5;
      rowHeight = Math.max(rowHeight, height);
    }
    return y + rowHeight;
  }

  private addChips(body: RulesPreviewBody, items: CardCounterPresentation[], y: number): number {
    let x = 0;
    let rowHeight = 0;
    for (const item of items) {
      const foreground = this.theme.gameTheme.textOnTinted;
      const content = new Container();
      const iconSize = 14;
      if (item.iconName) {
        const icon = new Sprite(Texture.EMPTY);
        icon.setSize(iconSize, iconSize);
        icon.tint = hexToNum(foreground);
        content.addChild(icon);
        void gameIconTexture(item.iconName)
          .then((texture) => {
            if (icon.destroyed) return;
            icon.texture = texture;
            icon.setSize(iconSize, iconSize);
            this.callbacks.onRenderRequested();
          })
          .catch(() => undefined);
      }
      const text = item.iconName
        ? (item.displayCount?.toString() ?? "")
        : `${item.label}${item.displayCount == null ? "" : ` ${item.displayCount}`}`;
      if (text) {
        const label = new Text({
          text,
          style: textStyle(foreground, 11, "600"),
          resolution: 2,
        });
        label.position.set(item.iconName ? iconSize + 3 : 0, (iconSize - label.height) / 2);
        content.addChild(label);
      }
      content.scale.x = Math.min(1, (body.contentWidth - 14) / content.width);
      const width = Math.min(body.contentWidth, content.width + 14);
      const height = 21;
      if (x > 0 && x + width > body.contentWidth) {
        x = 0;
        y += rowHeight + 5;
        rowHeight = 0;
      }
      const chip = new Container();
      const background = new Graphics();
      background.roundRect(0, 0, width, height, 10.5);
      background.fill(hexToNum(this.theme.gameTheme.counter[item.colorKey]));
      content.position.set(7, (height - iconSize) / 2);
      chip.position.set(x, y);
      chip.addChild(background, content);
      body.content.addChild(chip);
      x += width + 5;
      rowHeight = Math.max(rowHeight, height);
    }
    return y + rowHeight;
  }

  private addActionRows(
    body: RulesPreviewBody,
    entries: IndexedPreviewAction[],
    y: number,
    primary = false,
  ): number {
    if (!primary && entries.length === 0) return y;
    const view = primary ? this.actions : new RulesPreviewActions();
    if (!primary) {
      this.extraActions.push(view);
      view.on("pointerover", () => this.callbacks.onRenderRequested());
      view.on("pointerout", () => this.callbacks.onRenderRequested());
    }
    view.setContent({
      width: body.contentWidth,
      maxHeight: Number.POSITIVE_INFINITY,
      theme: this.theme,
      frame: this.frame,
      actions: entries,
      controls: [],
      statuses: [],
      hint: "",
      label: "",
      onSelectAction: (action) => this.callbacks.onSelectAction(action),
      onHoverAction: (index) => {
        const previous =
          this.focusedAction === null ? undefined : this.actionPanels.get(this.focusedAction)?.view;
        this.focusedAction = entries[index]!.index;
        if (previous !== view) previous?.clearFocus();
      },
      embedded: true,
      compact: body.bodyHeight < 48,
    });
    entries.forEach((entry, index) => this.actionPanels.set(entry.index, { view, index, body }));
    if (this.focusedAction !== null) {
      const focused = this.actionPanels.get(this.focusedAction);
      if (focused?.view === view) view.focusActionAt(focused.index);
      else view.clearFocus();
    }
    if (entries.length === 0) return y;
    view.position.set(0, y);
    body.content.addChild(view);
    return y + view.panelHeight + SECTION_GAP;
  }

  private addSectionTint(
    body: RulesPreviewBody,
    y: number,
    height: number,
    activeColor?: string,
    highlighted = false,
  ): void {
    if (!activeColor && !highlighted) return;
    const color = hexToNum(highlighted ? this.theme.gameTheme.activeAction.active : activeColor!);
    const tint = new Graphics({
      label: highlighted ? "stack-effect-highlight" : "active-mechanic-section",
      eventMode: "none",
    })
      .rect(0, y, body.contentWidth, height)
      .fill({ color, alpha: highlighted ? 0.28 : ACTIVE_SECTION_ALPHA });
    body.content.addChildAt(tint, 0);
    if (highlighted) {
      const marker = new Graphics().rect(0, y, 4, height).fill(color);
      marker.eventMode = "none";
      body.content.addChildAt(marker, 1);
      this.highlightedRows.push(tint);
      body.highlightedRowTop ??= y;
    }
  }

  private addStaticAbilityRow(body: RulesPreviewBody, text: string, y: number): number {
    const style = oracleTextStyle(this.frame.ink, this.rulesFontSize, false, this.frame.bodyFont);
    style.fontWeight = "700";
    return this.addOracleAbilityRow(body, text, y, false, body.content, style);
  }

  private addOracleAbilityRow(
    body: RulesPreviewBody,
    text: string,
    y: number,
    planeswalker: boolean,
    parent = body.content,
    style = oracleTextStyle(this.frame.ink, this.rulesFontSize, false, this.frame.bodyFont),
  ): number {
    const native = planeswalker ? body.planeswalker : undefined;
    const loyalty = native
      ? specialRules({
          name: this.spec!.card.identity.name,
          rulesText: text,
          typeLine: "Planeswalker",
        })[0]
      : null;
    const cost = loyalty?.badges[0];
    const content = cost ? loyalty!.text : text;
    const column = native ? (cost ? native.text : native.staticText) : null;
    const contentX = column?.x ?? 0;
    const row = new Container();
    const rich = new PixiRichText();
    const textHeight = rich.setContent(
      content,
      style,
      column?.width ?? body.contentWidth,
      this.rulesFontSize,
      0,
      {
        parentheticalStyle: oracleTextStyle(
          this.frame.mutedInk,
          this.rulesFontSize,
          true,
          this.frame.bodyFont,
        ),
      },
    );
    const height = Math.max(
      native?.minimumRowHeight ?? 0,
      cost ? native!.badge.height : 0,
      textHeight,
    );
    rich.position.set(contentX, native ? (height - textHeight) / 2 : 0);
    row.position.set(0, y);
    const highlightedEffect = this.spec?.highlightedEffect?.trim();
    if (
      highlightedEffect &&
      (rulesEntryMatchesStackAbility(text, highlightedEffect) || text === this.highlightedEntry)
    ) {
      const color = hexToNum(this.theme.gameTheme.activeAction.active);
      const highlight = new Graphics()
        .roundRect(-4, 0, body.contentWidth + 8, height, 6)
        .fill({ color, alpha: 0.28 });
      const marker = new Graphics().roundRect(-4, 0, 4, height, 2).fill(color);
      row.addChild(highlight, marker);
      this.highlightedRows.push(row);
      body.highlightedRowTop ??= y;
    }
    row.addChild(rich);
    if (cost && native) {
      addPlaneswalkerCost(row, cost, height, native, () => this.callbacks.onRenderRequested());
    }
    parent.addChild(row);
    return y + height + (native ? PLANESWALKER_SECTION_GAP : this.rulesFontSize * ABILITY_GAP_EM);
  }

  private addFlavorText(
    body: RulesPreviewBody,
    text: string,
    y: number,
    parent = body.content,
    width = body.contentWidth,
  ): number {
    y += SECTION_GAP / 2;
    const rich = new PixiRichText();
    const height = rich.setContent(
      text,
      oracleTextStyle(this.frame.mutedInk, this.rulesFontSize, true, this.frame.bodyFont),
      width,
      this.rulesFontSize,
      0,
    );
    const divider = new Graphics();
    divider.moveTo(0, y).lineTo(width, y);
    divider.stroke({ color: hexToNum(this.frame.border), alpha: 0.45, width: 1 });
    parent.addChild(divider);
    rich.position.set(0, y + this.rulesFontSize * FLAVOR_GAP_EM);
    parent.addChild(rich);
    return y + height + this.rulesFontSize * (FLAVOR_GAP_EM + ABILITY_GAP_EM);
  }

  private configureGeometry(
    landscape: boolean,
    faceIndex: number,
  ): readonly CardInteractionPanel[] {
    this.scanOverlay =
      this.preserveArtwork ||
      (!this.faceGeometry && !!this.scryfallInfo && hasIntegratedArtwork(this.scryfallInfo));
    this.panelWidth = landscape ? LANDSCAPE_WIDTH : PORTRAIT_WIDTH;
    this.panelHeight = landscape ? LANDSCAPE_HEIGHT : PORTRAIT_HEIGHT;
    this.faceWidth = this.panelWidth;
    this.artY = PORTRAIT_HEADER_HEIGHT;
    if (!this.scanOverlay) {
      const panels = getCardInteractionPanels(this.faceGeometry, landscape);
      return this.faceGeometry
        ? panels
        : panels.map((panel) => ({
            ...panel,
            faceIndex,
            region: { ...panel.region, faceIndex },
          }));
    }
    const scale = PORTRAIT_WIDTH / CARD_RENDER_WIDTH;
    const top = this.panelHeight * SCAN_OVERLAY_TOP_FRACTION;
    return [
      {
        id: "scan-overlay",
        faceIndex,
        kind: "face",
        exclusions: [],
        region: {
          name: "scan-overlay",
          role: "rules",
          faceIndex,
          x: SCAN_OVERLAY_INSET / scale,
          y: top / scale,
          width: (this.panelWidth - SCAN_OVERLAY_INSET * 2) / scale,
          height: (this.panelHeight - top - SCAN_OVERLAY_INSET) / scale,
          angle: 0,
        },
      },
    ];
  }

  private addTypeHeading(body: RulesPreviewBody, typeLine: string): void {
    const heading = new Text({
      text: typeLine,
      style: new TextStyle({
        fontFamily: this.frame.bodyFont,
        fontSize: 14,
        fontWeight: "700",
        fill: this.frame.ink,
        wordWrap: true,
        wordWrapWidth: body.contentWidth,
      }),
    });
    heading.resolution = 2;
    heading.position.set(body.contentX, RULES_INSET);
    heading.eventMode = "none";
    body.chrome.addChild(heading);
    body.bodyTop = heading.height + RULES_INSET * 3;
    body.bodyHeight = Math.max(1, body.height - body.bodyTop - RULES_INSET);
  }

  private drawFooter(
    body: RulesPreviewBody,
    stats: CardStatPresentation | null,
    loyalty: number | null,
    defense: number | null,
  ): void {
    if (!this.scanOverlay && this.faceTexture) {
      body.footer.visible = false;
      return;
    }
    body.footer.position.set(0, body.height - STAT_BADGE_HEIGHT);
    let right = body.width - CONTENT_PAD;
    if (stats) {
      right = drawRulesStatBadge(body.footer, stats, right, 3, this.frame, this.theme);
    }
    if (loyalty != null) this.drawShieldValue(body, loyalty, i18n._(msg`Loyalty`), right);
    else if (defense != null) this.drawShieldValue(body, defense, i18n._(msg`Defense`), right);
    body.footer.visible =
      body.footer.children.length > 0 && (this.scanOverlay || !this.faceTexture);
    if (body.footer.visible) {
      const bounds = body.footer.getLocalBounds();
      body.statBounds.set(
        Math.max(body.contentX, bounds.x - RULES_INSET),
        Math.max(body.bodyTop, body.footer.y + bounds.y - RULES_INSET),
        bounds.width + RULES_INSET * 2,
        bounds.height + RULES_INSET * 2,
      );
    } else body.statBounds.set(0, body.height, 0, 0);
  }

  private drawShieldValue(
    body: RulesPreviewBody,
    value: number,
    label: string,
    right: number,
  ): void {
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
    body.footer.addChild(badge, labelText, valueText);
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
    this.layoutX = x;
    this.layoutY = y;
    this.layoutScale = scale;
    this.viewControls.setParentScale(scale, scale, this.panelWidth, this.artY);
    const anchorX = spec.anchor?.x ?? spec.pointer.x;
    const anchorY = spec.anchor?.y ?? spec.pointer.y;
    const anchorWidth = spec.anchor?.width ?? 0;
    const anchorHeight = spec.anchor?.height ?? 0;
    this.cardBounds.x = 0;
    this.cardBounds.width = this.panelWidth;
    this.cardBounds.height = this.widgetHeight;
    this.anchorBounds.x = (anchorX - x) / scale;
    this.anchorBounds.y = (anchorY - y) / scale;
    this.anchorBounds.width = anchorWidth / scale;
    this.anchorBounds.height = anchorHeight / scale;
    this.layoutDetails();
    if (spec.phase === "open" && !spec.suppressed) this.applyEntrancePose();
    if (this.selectRasterTier() !== this.renderTier) void this.loadFace();
  }

  private layoutDetails(): void {
    let exclusionIndex = 0;
    for (let index = 0; index < this.bodies.length; index += 1) {
      const body = this.bodies[index]!;
      body.background.clear();
      if (this.scanOverlay) {
        body.background
          .roundRect(0, 0, body.width, body.height, RULES_CARD_CONSTRAINTS.radius)
          .fill({ color: hexToNum(body.frame.paper), alpha: SCAN_OVERLAY_OPACITY });
      } else if (!this.faceGeometry?.rules.length) {
        body.background.rect(0, 0, body.width, body.height).fill(hexToNum(body.frame.paper));
      }
      body.layout();
      const regions = [body.region, ...body.reminderRegions];
      if (body.sagaRail) regions.push(body.markerRegion);
      for (const region of regions) {
        const exclusion = (this.foilRulesExclusions[exclusionIndex] ??= new Rectangle());
        exclusion.copyFrom(region);
        exclusion.x -= this.foilSurface.x;
        exclusion.y -= this.foilSurface.y;
        this.screenFoilExclusions[exclusionIndex] ??= new Rectangle();
        exclusionIndex += 1;
      }
    }
    this.foilRulesExclusions.length = exclusionIndex;
    this.screenFoilExclusions.length = exclusionIndex;
    this.foil?.setExclusions(this.foilRulesExclusions);
  }

  private applyLightingPose(): void {
    const spec = this.spec;
    if (!spec || !this.foil) return;
    this.materialPose.yaw =
      (spec.pose?.yaw ?? 0) + Math.acos(Math.max(-1, Math.min(1, this.flip.scale)));
    this.materialPose.pitch = spec.pose?.pitch ?? 0;
    this.foil.setLighting(spec.lighting ?? "pointer", this.materialPose);
  }

  private applyEntrancePose(): void {
    const remaining = 1 - this.entrance.progress;
    this.container.position.set(
      this.layoutX + (this.entrance.x - this.layoutX) * remaining,
      this.layoutY + (this.entrance.y - this.layoutY) * remaining,
    );
    const scale = this.layoutScale + (this.entrance.scale - this.layoutScale) * remaining;
    this.container.x += (this.panelWidth * scale * (1 - this.flip.scale)) / 2;
    this.container.scale.set(scale * this.flip.scale, scale);
    this.container.alpha = this.entrance.progress;
    this.applyLightingPose();
    for (let index = 0; index < this.foilRulesExclusions.length; index += 1) {
      const region = this.foilRulesExclusions[index];
      this.screenFoilExclusions[index].set(
        this.container.x + (region.x + this.foilSurface.x) * this.container.scale.x,
        this.container.y + (region.y + this.foilSurface.y) * this.container.scale.y,
        region.width * this.container.scale.x,
        region.height * this.container.scale.y,
      );
    }
  }

  private animateIn(fromHidden: boolean): void {
    const spec = this.spec;
    if (!spec) return;
    if (
      this.renderState === "loading" ||
      (this.faceSprite.texture === Texture.EMPTY && this.renderState !== "error")
    ) {
      this.hide(true);
      this.pendingEntry = true;
      return;
    }
    this.pendingEntry = false;
    this.container.visible = true;
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    gsap.killTweensOf(this.entrance);
    this.entrance.progress = 1;
    this.armInteraction();
    if (!fromHidden || !animationsEnabled() || prefersReducedMotion()) {
      this.applyEntrancePose();
      return;
    }

    this.entrance.x = spec.anchor ? spec.anchor.x + spec.anchor.width / 2 : spec.pointer.x;
    this.entrance.y = spec.anchor ? spec.anchor.y + spec.anchor.height / 2 : spec.pointer.y;
    this.entrance.scale = spec.anchor
      ? Math.max(0.25, Math.min(0.85, spec.anchor.width / this.panelWidth))
      : 0.5;
    this.entrance.progress = 0;
    this.applyEntrancePose();
    gsap.to(this.entrance, {
      progress: 1,
      duration: PREVIEW_TIMING.enterMs / 1000,
      ease: "power3.out",
      onUpdate: () => {
        this.applyEntrancePose();
        this.callbacks.onRenderRequested();
      },
    });
  }

  private showImmediately(): void {
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    gsap.killTweensOf(this.entrance);
    this.pendingEntry = false;
    this.entrance.progress = 1;
    this.applyEntrancePose();
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
    this.pendingEntry = false;
    gsap.killTweensOf(this.entrance);
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

  private async loadFace(refreshMetadata = false): Promise<void> {
    // Input keys omit mutable metadata; revalidate it when resuming a retained face.
    const spec = this.spec;
    if (!spec) return;
    const hidden = spec.card.isFaceDown || !spec.card.identity.name;
    const deckCard = hidden ? undefined : previewDeckCard(spec.card);
    const request: CardRenderRequest = {
      card: spec.card,
      deckCard,
      faceIndex: spec.showBackFace ? 1 : 0,
    };
    const tier = this.selectRasterTier();
    const inputKey = hidden ? "hidden" : JSON.stringify([cardRenderInputKey(request), tier]);
    if (
      !refreshMetadata &&
      inputKey === this.faceInputKey &&
      ((inputKey === this.completedFaceInputKey && this.imageReady) ||
        (this.renderAbort && !this.renderAbort.signal.aborted)) &&
      this.renderState !== "error"
    )
      return;
    this.faceInputKey = inputKey;
    this.renderTier = tier;
    this.renderAbort?.abort();
    const controller = new AbortController();
    this.renderAbort = controller;
    const generation = ++this.artGeneration;
    if (!this.imageReady) {
      this.renderState = "loading";
      this.faceSprite.label = "card-glint-loading";
    }
    let raster: CardRaster | null = null;
    try {
      raster = hidden ? null : await renderRulesCard(request, controller.signal, { tier });
      const geometry = raster ? getCardRenderGeometry(raster) : undefined;
      const cardBack = hidden ? await loadCardBack() : null;
      if (
        controller.signal.aborted ||
        generation !== this.artGeneration ||
        this.container.destroyed
      )
        return;
      this.completedFaceInputKey = inputKey;
      if (raster && this.faceTexture?.source.resource === raster) {
        this.spec?.flip?.onReady();
        this.callbacks.onRenderRequested();
        return;
      }
      const texture = raster ? createGeneratedCardTexture(raster) : cardBack!;
      const previous = this.faceTexture;
      this.foil?.setTexture(null);
      this.faceGeometry = geometry;
      this.preserveArtwork = false;
      this.faceTexture = hidden ? null : texture;
      this.faceSprite.texture = texture;
      this.renderState = "ready";
      this.faceSprite.label = hidden ? "card-back" : "card-glint-ready";
      this.rebuild();
      this.spec?.flip?.onReady();
      this.callbacks.onRenderRequested();
      previous?.destroy(true);
      if (!hidden && this.canFlip && deckCard?.backFace) {
        void renderRulesCard(
          { ...request, faceIndex: spec.showBackFace ? 0 : 1 },
          controller.signal,
          { tier },
        ).then(releaseCardRaster, () => undefined);
      }
    } catch (cause: unknown) {
      if (
        controller.signal.aborted ||
        generation !== this.artGeneration ||
        this.container.destroyed
      )
        return;
      const texture = deckCard
        ? await useScryfallStore
            .getState()
            .getCardTexture(deckCard, "full", spec.showBackFace ? 1 : 0)
            .catch(() => Texture.EMPTY)
        : Texture.EMPTY;
      if (
        controller.signal.aborted ||
        generation !== this.artGeneration ||
        this.container.destroyed
      )
        return;
      if (this.faceTexture) this.clearFaceTexture();
      this.faceInputKey = inputKey;
      this.renderState = "error";
      this.preserveArtwork =
        cause instanceof CardArtworkError ||
        (!!this.scryfallInfo && hasIntegratedArtwork(this.scryfallInfo));
      this.faceSprite.label = "card-glint-original";
      this.faceGeometry = undefined;
      this.faceSprite.texture = texture;
      this.completedFaceInputKey = inputKey;
      this.rebuild();
      if (texture !== Texture.EMPTY) this.spec?.flip?.onReady();
      this.callbacks.onRenderRequested();
    } finally {
      if (raster) releaseCardRaster(raster);
    }
  }

  private clearFaceTexture(): void {
    this.faceInputKey = null;
    this.completedFaceInputKey = null;
    this.faceSprite.texture = Texture.EMPTY;
    this.foil?.setTexture(null);
    this.liveHighlight.setSource(null);
    this.callbacks.onRenderRequested();
    this.faceTexture?.destroy(true);
    this.faceTexture = null;
  }

  private fitFace(): void {
    const texture = this.faceSprite.texture;
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
    if (this.faceGeometry && !this.scanOverlay) {
      this.faceSprite.scale.set(this.faceWidth / width, this.panelHeight / height);
    } else {
      this.faceSprite.scale.set(Math.min(this.faceWidth / width, this.panelHeight / height));
    }
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
    this.flip.cancel();
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    gsap.killTweensOf(this.entrance);
    this.pendingEntry = false;
    this.entrance.progress = 1;
    this.highlightedEffectTween?.kill();
    this.highlightedEffectTween = null;
    for (const row of this.highlightedRows) row.alpha = 1;
    if (this.interactionTimer != null) {
      window.clearTimeout(this.interactionTimer);
      this.interactionTimer = null;
    }
    this.interactiveReady = false;
    if (!preserveHover && !this.spec) this.clearHover();
    this.bodyPointerId = null;
    for (const body of this.bodies) body.cancelInteraction();
    for (const view of [this.actions, ...this.extraActions]) view.cancelInteraction();
    this.controls.cancelInteraction();
    this.container.visible = false;
    this.container.alpha = 0;
  }

  destroy(): void {
    this.unsubscribePreferences();
    if (this.spec?.flip) this.spec.flip.handleRef.current = null;
    this.clearHover();
    this.hide();
    this.artGeneration += 1;
    this.cardInfoGeneration += 1;
    this.renderAbort?.abort();
    this.unsubscribeLocale();
    this.clearFaceTexture();
    this.liveHighlight.destroy();
    this.actions.destroy();
    for (const view of this.extraActions) view.destroy({ children: true });
    this.controls.destroy();
    this.container.destroy({ children: true });
  }
}
