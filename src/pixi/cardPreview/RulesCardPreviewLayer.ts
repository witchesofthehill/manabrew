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
import type { ClientCardDto } from "@/stores/gameStore.types";
import type { ScryfallCard } from "@/types/scryfall";
import { resolveCardFaces } from "@/lib/cardFaces";
import type { PreviewPhase } from "@/lib/cardPreview";
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
  resolveRulesPreviewDisplay,
  rulesTextEntries,
} from "@/pixi/cardPreview/rulesCardPreviewPresentation";
import { RulesPreviewIdentity } from "@/pixi/cardPreview/RulesPreviewIdentity";
import { RulesPreviewActions } from "@/pixi/cardPreview/RulesPreviewActions";
import {
  drawRulesPreviewFrame,
  resolveRulesPreviewFrame,
  RULES_BODY_FONT,
  RULES_TITLE_FONT,
  type RulesPreviewFrameStyle,
} from "@/pixi/cardPreview/rulesPreviewFrame";
import { loadCardBack } from "@/pixi/CardSprite";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import { useGameStore } from "@/stores/useGameStore";
import { asDeckCard } from "@/lib/decks";
import { isFacelessCard } from "@/lib/gameCard";
import { gsap } from "@/pixi/effects/gsap";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { PREVIEW_TIMING } from "@/lib/cardPreview";
import { containsPreviewHoverBridge } from "@/pixi/cardPreview/previewHoverArea";
import { usePreferencesStore, type RulesPreviewSectionId } from "@/stores/usePreferencesStore";
import {
  RulesPreviewSectionHeader,
  PREVIEW_SECTION_HEADER_HEIGHT,
} from "./RulesPreviewSectionHeader";
import { parseManaCost } from "@/pixi/manaSymbols";

export interface RulesCardPreviewSpec {
  card: ClientCardDto;
  phase: Exclude<PreviewPhase, "hidden">;
  sticky: boolean;
  showBackFace: boolean;
  suppressed: boolean;
  actions: HandActionOption[];
  anchor: { x: number; y: number; width: number; height: number } | null;
  pointer: { x: number; y: number };
}

export interface RulesCardPreviewCallbacks {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onInteractionReady: () => void;
  onSelectAction: (action: HandActionOption) => void;
  onDismiss: () => void;
  onFlip: () => void;
}

const PORTRAIT_WIDTH = 360;
const PORTRAIT_HEIGHT = PORTRAIT_WIDTH * (7 / 5);
const LANDSCAPE_WIDTH = PORTRAIT_HEIGHT;
const LANDSCAPE_HEIGHT = PORTRAIT_WIDTH;
const EDGE_PAD = 12;
const PANEL_GAP = 18;
const PORTRAIT_HEADER_HEIGHT = 52;
const LANDSCAPE_HEADER_HEIGHT = 48;
const PORTRAIT_ART_HEIGHT = 184;
const TYPE_HEIGHT = 32;
const FOOTER_HEIGHT = 40;
const FRAME_BOTTOM_PAD = 16;
const CONTENT_PAD = 16;
const ART_INSET = 8;
const ART_RADIUS = 8;
const LANDSCAPE_ART_HEIGHT = 152;
const FACE_GAP = 8;
const ACTION_PANEL_GAP = 8;
const ACTION_PANEL_MAX_HEIGHT = 160;
const ORACLE_LINE_HEIGHT = 20;
const ABILITY_GAP = 10;
const ENTRY_INTERACTION_PAD_MS = 80;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function textStyle(
  fill: string,
  fontSize: number,
  fontWeight: "400" | "500" | "600" | "700" = "400",
  fontFamily = "Inter, system-ui, sans-serif",
): TextStyle {
  return new TextStyle({ fill, fontSize, fontWeight, fontFamily, lineHeight: fontSize * 1.3 });
}

function oracleTextStyle(fill: string, italic = false): TextStyle {
  return new TextStyle({
    fill,
    fontFamily: RULES_BODY_FONT,
    fontSize: 15,
    fontWeight: "400",
    fontStyle: italic ? "italic" : "normal",
    lineHeight: ORACLE_LINE_HEIGHT,
  });
}

export class RulesCardPreviewLayer {
  readonly container = new Container();
  private cardContainer = new Container();
  private cardBounds = new Rectangle();
  private controlsBounds = new Rectangle();
  private anchorBounds = new Rectangle();
  private pointerOnPreview = false;
  private layoutX = 0;
  private layoutY = 0;
  private layoutScale = 1;

  private theme: Theme;
  private frame: RulesPreviewFrameStyle;
  private callbacks: RulesCardPreviewCallbacks;
  private background = new Graphics();
  private artSprite = new Sprite(Texture.EMPTY);
  private artFaces = new Container<Sprite>();
  private artMask = new Graphics();
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
  private sectionHeaders: Array<{ id: RulesPreviewSectionId; header: RulesPreviewSectionHeader }> =
    [];
  private focusedSection: RulesPreviewSectionId | null = null;
  private spec: RulesCardPreviewSpec | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private panelWidth = PORTRAIT_WIDTH;
  private panelHeight = PORTRAIT_HEIGHT;
  private widgetHeight = PORTRAIT_HEIGHT;
  private faceCount = 1;
  private faceWidth = PORTRAIT_WIDTH;
  private headerHeight = PORTRAIT_HEADER_HEIGHT;
  private bodyTop = PORTRAIT_HEADER_HEIGHT + PORTRAIT_ART_HEIGHT + TYPE_HEIGHT;
  private bodyHeight = 0;
  private footerHeight = FOOTER_HEIGHT;
  private contentX = CONTENT_PAD;
  private contentWidth = PORTRAIT_WIDTH - CONTENT_PAD * 2;
  private artX = ART_INSET;
  private artY = PORTRAIT_HEADER_HEIGHT;
  private artWidth = PORTRAIT_WIDTH - ART_INSET * 2;
  private artHeight = PORTRAIT_ART_HEIGHT;
  private typeBandY = PORTRAIT_HEADER_HEIGHT + PORTRAIT_ART_HEIGHT;
  private contentHeight = 0;
  private scrollOffset = 0;
  private artGeneration = 0;
  private cardInfoGeneration = 0;
  private scryfallInfo: ScryfallCard | null = null;
  private displayedBackFace = false;
  private horizontalFace = false;
  private forcePortrait = false;
  private canFlip = false;
  private interactiveReady = false;
  private interactionTimer: number | null = null;
  private dragStartY: number | null = null;
  private dragPointerId: number | null = null;
  private dragStartScroll = 0;

  constructor(theme: Theme, callbacks: RulesCardPreviewCallbacks) {
    this.theme = theme;
    this.frame = resolveRulesPreviewFrame(theme);
    this.callbacks = callbacks;
    this.container.visible = false;
    this.container.sortableChildren = true;
    this.container.eventMode = "static";
    this.container.cursor = "default";
    this.container.on("pointerdown", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.focusedSection = null;
      for (const { header } of this.sectionHeaders) header.setFocused(false);
    });
    this.container.hitArea = {
      contains: (x, y) => this.interactiveReady && this.containsHoverArea(x, y),
    };

    this.artSprite.mask = this.artMask;
    this.artFaces.mask = this.artMask;
    this.bodyScroller.mask = this.bodyMask;
    this.bodyScroller.addChild(this.bodyContent);
    this.bodyScroller.eventMode = "static";
    this.bodyScroller.on("pointerdown", (event: FederatedPointerEvent) => {
      if (event.pointerType !== "touch" || this.dragPointerId !== null) return;
      this.dragPointerId = event.pointerId;
      this.dragStartY = event.global.y;
      this.dragStartScroll = this.scrollOffset;
    });
    this.bodyScroller.on("globalpointermove", (event: FederatedPointerEvent) => {
      if (this.dragStartY == null || event.pointerId !== this.dragPointerId) return;
      const delta = event.global.y - this.dragStartY;
      this.setScroll(this.dragStartScroll - delta / this.container.scale.y);
    });
    const endDrag = (event: FederatedPointerEvent) => {
      if (event.pointerId !== this.dragPointerId) return;
      this.dragStartY = null;
      this.dragPointerId = null;
    };
    this.bodyScroller.on("pointerup", endDrag);
    this.bodyScroller.on("pointerupoutside", endDrag);
    this.bodyScroller.on("pointercancel", endDrag);

    this.cardContainer.addChild(
      this.background,
      this.artSprite,
      this.artFaces,
      this.artMask,
      this.chrome,
      this.bodyScroller,
      this.bodyMask,
      this.footer,
      this.scrollTrack,
      this.scrollThumb,
      this.scrollFade,
    );
    this.container.addChild(this.cardContainer, this.controls);
  }

  setCallbacks(callbacks: RulesCardPreviewCallbacks): void {
    this.callbacks = callbacks;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    if (this.spec) this.rebuild();
  }

  setViewport(width: number, height: number): void {
    if (width === this.viewportWidth && height === this.viewportHeight) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    if (width <= EDGE_PAD * 2 || height <= EDGE_PAD * 2) this.setSpec(null);
    else if (this.spec) this.rebuild();
  }

  setSpec(spec: RulesCardPreviewSpec | null): void {
    const previous = this.spec;
    this.spec = spec;
    if (!spec || this.viewportWidth <= EDGE_PAD * 2 || this.viewportHeight <= EDGE_PAD * 2) {
      this.spec = null;
      this.hide();
      return;
    }

    const cardChanged = previous?.card.id !== spec.card.id;
    const lookupChanged =
      cardChanged ||
      previous?.card.identity.name !== spec.card.identity.name ||
      previous?.card.identity.setCode !== spec.card.identity.setCode ||
      previous?.card.identity.cardNumber !== spec.card.identity.cardNumber;
    const faceChanged = previous?.showBackFace !== spec.showBackFace;
    const contentChanged = !previous || previous.card !== spec.card;
    const actionsChanged =
      !previous ||
      previous.actions.length !== spec.actions.length ||
      previous.actions.some((action, index) => action !== spec.actions[index]);
    if (
      spec.actions.length > 0 &&
      (!previous || previous.actions.length === 0 || previous.card.id !== spec.card.id)
    ) {
      usePreferencesStore.getState().setRulesPreviewSectionCollapsed("actions", false);
    }
    if (
      spec.actions.length === 0 &&
      (!previous || previous.actions.length > 0 || previous.card.id !== spec.card.id)
    ) {
      usePreferencesStore.getState().setRulesPreviewSectionCollapsed("rules", false);
    }
    if (cardChanged) {
      this.forcePortrait = false;
      this.focusedSection = null;
    }
    if (lookupChanged) {
      this.displayedBackFace = spec.showBackFace;
      this.artSprite.texture = Texture.EMPTY;
      this.cardInfoGeneration += 1;
      this.scryfallInfo = isFacelessCard(spec.card)
        ? null
        : peekCard(useScryfallStore.getState().cards, {
            name: spec.card.identity.name,
            setCode: spec.card.identity.setCode || undefined,
            collectorNumber: spec.card.identity.cardNumber || undefined,
          });
      if (!this.scryfallInfo) void this.loadCardInfo();
    }
    if (lookupChanged || faceChanged) {
      this.scrollOffset = 0;
      this.actions.reset();
      this.artGeneration += 1;
      if (this.scryfallInfo || isFacelessCard(spec.card)) void this.loadArt();
    }
    if (
      contentChanged ||
      actionsChanged ||
      faceChanged ||
      previous?.sticky !== spec.sticky ||
      previous?.suppressed !== spec.suppressed ||
      previous?.phase !== spec.phase
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
      if (spec.phase === "closing") this.animateOut();
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
    return (
      this.cardBounds.contains(localX, localY) ||
      (this.controls.visible && this.controlsBounds.contains(localX, localY))
    );
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
      (this.controls.visible &&
        (this.controlsBounds.contains(x, y) ||
          containsPreviewHoverBridge(x, y, this.cardBounds, this.controlsBounds))) ||
      (!!this.spec &&
        !this.spec.sticky &&
        containsPreviewHoverBridge(x, y, this.anchorBounds, this.cardBounds))
    );
  }

  focusAction(delta: number): void {
    this.focusedSection = null;
    if (!this.revealActions()) return;
    for (const { header } of this.sectionHeaders) header.setFocused(false);
    this.actions.focusAction(delta);
    const row = this.actions.focusedActionBounds;
    if (row) this.scrollIntoView(this.actions.y + row.top, row.height);
  }

  activateFocusedAction(): void {
    if (this.focusedSection !== null) return;
    if (this.isCollapsed("actions")) {
      this.focusAction(0);
      return;
    }
    this.actions.activateFocusedAction();
  }

  activateShortcut(shortcut: number): boolean {
    return this.actions.activateShortcut(shortcut);
  }

  focusSection(delta: number): void {
    const ids = [...new Set(this.sectionHeaders.map(({ id }) => id))];
    if (ids.length === 0) return;
    const index =
      this.focusedSection === null ? (delta < 0 ? 0 : -1) : ids.indexOf(this.focusedSection);
    this.focusedSection = ids[(index + delta + ids.length) % ids.length]!;
    for (const { id, header } of this.sectionHeaders) header.setFocused(id === this.focusedSection);
    const entry = this.sectionHeaders.find(({ id }) => id === this.focusedSection)!;
    if (entry.header.parent === this.bodyContent) {
      this.scrollIntoView(entry.header.y, PREVIEW_SECTION_HEADER_HEIGHT);
    }
  }

  activateFocusedSection(): boolean {
    if (this.focusedSection === null) return false;
    this.toggleSection(this.focusedSection);
    return true;
  }

  private revealActions(): boolean {
    if (!this.spec?.actions.length) return false;
    if (this.isCollapsed("actions")) {
      usePreferencesStore.getState().setRulesPreviewSectionCollapsed("actions", false);
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
    if (this.horizontalFace) {
      this.forcePortrait = !this.forcePortrait;
      this.scrollOffset = 0;
      this.rebuild();
      return;
    }
    if (this.canFlip) this.callbacks.onFlip();
  }

  scrollBy(delta: number, mode: number, x: number, y: number): void {
    if (
      this.controls.visible &&
      this.controlsBounds.contains(
        (x - this.container.x) / this.container.scale.x,
        (y - this.container.y) / this.container.scale.y,
      )
    ) {
      this.controls.scrollBy(delta, mode, this.container.scale.y);
      return;
    }
    const unit =
      mode === 1 ? ORACLE_LINE_HEIGHT : mode === 2 ? this.bodyHeight : 1 / this.container.scale.y;
    this.setScroll(this.scrollOffset + delta * unit);
  }

  private rebuild(): void {
    const spec = this.spec;
    if (!spec || this.viewportWidth <= 0 || this.viewportHeight <= 0) return;
    this.actions.removeFromParent();
    this.sectionHeaders = [];
    this.chrome.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.bodyContent.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.footer.removeChildren().forEach((child) => child.destroy({ children: true }));

    const presentation = deriveCardPresentation(spec.card);
    const deckCard = asDeckCard(useGameStore.getState().gameDecks[spec.card.ownerId], spec.card);
    const display = resolveRulesPreviewDisplay({
      card: spec.card,
      presentation,
      info: this.scryfallInfo,
      deckLayout: deckCard.layout,
      showBackFace: this.displayedBackFace,
      faceless: isFacelessCard(spec.card),
    });
    const progression =
      display.currentFace && !display.multipart && !display.faceless
        ? presentation.progression
        : null;
    const nextClassLevel =
      progression?.rail.kind === "class" && progression.rail.current < progression.rail.max
        ? progression.rail.current + 1
        : null;
    const classLevelUpIndex = nextClassLevel
      ? spec.actions.findIndex((action) => action.isClassLevelUp)
      : -1;
    const classActionIndex = classLevelUpIndex >= 0 ? classLevelUpIndex : null;
    const indexedActions = spec.actions.map((action, index) => ({
      action,
      shortcut: getPreviewActionShortcut(
        index,
        classActionIndex,
        classActionIndex === null ? null : nextClassLevel,
      ),
    }));
    this.horizontalFace = display.horizontal;
    this.canFlip = display.flippable;
    const landscape = display.horizontal && !this.forcePortrait;
    const faceColumns = display.multipart && landscape;
    const identities = faceColumns ? display.sections : [display];
    const hasFooterValue = display.stats || display.loyalty != null || display.defense != null;
    this.configureGeometry(
      landscape,
      hasFooterValue ? FOOTER_HEIGHT : FRAME_BOTTOM_PAD,
      identities.length,
    );
    this.frame = resolveRulesPreviewFrame(this.theme);

    let typeHeight = TYPE_HEIGHT;
    for (const [index, section] of identities.entries()) {
      const identity = new RulesPreviewIdentity({
        section,
        width: this.faceWidth,
        headerHeight: this.headerHeight,
        typeY: this.typeBandY,
        contentPad: CONTENT_PAD,
        fontFamily: RULES_TITLE_FONT,
        fontSize: faceColumns ? 21 : 26,
        info: this.scryfallInfo,
        setCode: spec.card.identity.setCode,
        faceless: display.faceless,
        theme: this.theme,
        frame: this.frame,
      });
      identity.x = index * (this.faceWidth + FACE_GAP);
      typeHeight = Math.max(typeHeight, identity.typeHeight);
      this.chrome.addChild(identity);
      if (!display.faceless) {
        const artHeader = new Container();
        artHeader.position.set(
          index * (this.faceWidth + FACE_GAP) + CONTENT_PAD,
          this.headerHeight + 4,
        );
        this.addSectionHeader("artwork", "Artwork", 0, artHeader);
        this.chrome.addChild(artHeader);
      }
    }
    this.bodyTop = this.typeBandY + typeHeight;
    this.bodyHeight = this.panelHeight - this.bodyTop - this.footerHeight;
    this.background.clear();
    this.artMask.clear();
    this.bodyMask.clear();
    for (let index = 0; index < this.faceCount; index += 1) {
      const x = index * (this.faceWidth + FACE_GAP);
      drawRulesPreviewFrame(this.background, this.frame, {
        x,
        y: 0,
        width: this.faceWidth,
        height: this.panelHeight,
        headerHeight: this.headerHeight,
        artInset: ART_INSET,
        artY: this.artY,
        artHeight: this.artHeight,
        typeY: this.typeBandY,
        typeHeight,
        footerHeight: this.footerHeight,
      });
      this.artMask.roundRect(x + this.artX, this.artY, this.artWidth, this.artHeight, ART_RADIUS);
      this.bodyMask.rect(x + this.contentX, this.bodyTop, this.contentWidth, this.bodyHeight);
    }
    this.artMask.fill(hexToNum(this.frame.paper));
    this.bodyMask.fill(hexToNum(this.frame.paper));
    this.fitArt();
    this.bodyScroller.position.set(this.contentX, this.bodyTop);

    let y = 8;
    this.actions.setContent({
      width: this.contentWidth,
      maxHeight: Number.POSITIVE_INFINITY,
      theme: this.theme,
      actions: indexedActions,
      controls: [],
      statuses: [],
      hint: spec.sticky && indexedActions.length > 0 ? "↑↓ select · Enter activate · 1–9" : "",
      label: "",
      onSelectAction: (action) => this.callbacks.onSelectAction(action),
      embedded: true,
    });
    const visibleCounters =
      progression?.rail.kind === "saga"
        ? presentation.counters.filter((counter) => counter.type !== "Lore")
        : presentation.counters;
    if (display.keywords.length > 0 || display.costs.length > 0 || visibleCounters.length > 0) {
      y = this.addSectionHeader(
        "details",
        "Keywords, costs & counters",
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
    if (indexedActions.length > 0) {
      y = this.addSectionHeader(
        "actions",
        `${display.otherFace ? "Available on current face" : "Available actions"} · ${indexedActions.length}`,
        y,
        this.bodyContent,
        this.theme.gameTheme.cardRing,
      );
      this.actions.visible = !this.isCollapsed("actions");
      if (this.actions.visible) {
        this.actions.position.set(0, y);
        this.bodyContent.addChild(this.actions);
        y += this.actions.panelHeight + 4;
      }
    }
    if (progression) {
      y = this.addSectionHeader("progression", "Progression", y);
      if (!this.isCollapsed("progression")) {
        const rail = new PixiCardRailPreview({
          state: progression.rail,
          effects: progression.effects,
          width: this.contentWidth,
          theme: this.theme,
          frame: this.frame,
        });
        rail.position.set(0, y);
        this.bodyContent.addChild(rail);
        y += rail.contentHeight + 8;
      }
    }
    const rulesEntries = display.sections.map((section) =>
      rulesTextEntries(section.rulesText, progression),
    );
    if (display.faceless) {
      y = this.addStaticAbilityRow("Card identity and rules are hidden.", y);
    } else if (rulesEntries.some((entries) => entries.length > 0)) {
      y = this.addSectionHeader("rules", "Rules text", y);
      if (!this.isCollapsed("rules")) {
        const startY = y;
        for (const [sectionIndex, section] of display.sections.entries()) {
          let sectionY = faceColumns ? startY : y;
          const parent = faceColumns ? new Container() : this.bodyContent;
          if (faceColumns) {
            parent.x = sectionIndex * (this.faceWidth + FACE_GAP);
            this.bodyContent.addChild(parent);
          } else if (display.multipart) {
            sectionY = this.addFaceHeading(
              section.name,
              section.manaCost,
              section.typeLine,
              sectionY,
            );
          }
          for (const text of rulesEntries[sectionIndex]!) {
            sectionY = this.addOracleAbilityRow(text, sectionY, section.planeswalker, parent);
          }
          y = faceColumns ? Math.max(y, sectionY) : sectionY;
        }
      }
    }
    if (display.sections.some((section) => section.flavorText)) {
      y = this.addSectionHeader("flavor", "Flavor text", y);
      if (!this.isCollapsed("flavor")) {
        const startY = y;
        for (const [sectionIndex, section] of display.sections.entries()) {
          if (!section.flavorText) continue;
          const parent = faceColumns ? new Container() : this.bodyContent;
          if (faceColumns) {
            parent.x = sectionIndex * (this.faceWidth + FACE_GAP);
            this.bodyContent.addChild(parent);
          } else if (display.multipart) {
            y = this.addFaceHeading(section.name, section.manaCost, section.typeLine, y);
          }
          const sectionY = this.addFlavorText(section.flavorText, faceColumns ? startY : y, parent);
          y = faceColumns ? Math.max(y, sectionY) : sectionY;
        }
      }
    }
    this.contentHeight = y + 8;
    this.bodyScroller.hitArea = new Rectangle(
      0,
      0,
      this.panelWidth - CONTENT_PAD * 2,
      this.bodyHeight,
    );
    this.drawFooter(display.stats, display.loyalty, display.defense);

    const controls: Array<{ label: string; activate: () => void }> = [];
    if (display.horizontal) {
      controls.push({
        label: this.forcePortrait ? "Landscape · F" : "Rotate · F",
        activate: () => this.activatePrimaryTransform(),
      });
    }
    if (display.flippable) {
      controls.push({
        label: `Flip ${display.faceIndex === 0 ? "back" : "front"}${display.horizontal ? "" : " · F"}`,
        activate: () => this.callbacks.onFlip(),
      });
    }
    if (spec.sticky) {
      controls.push({ label: "Close · Esc", activate: () => this.callbacks.onDismiss() });
    }
    this.controls.setContent({
      width: this.panelWidth,
      maxHeight: ACTION_PANEL_MAX_HEIGHT,
      theme: this.theme,
      actions: [],
      controls,
      statuses: presentation.statuses,
      hint: display.otherFace ? "Printed face · live state belongs to the other face" : "",
      label: "",
      onSelectAction: (action) => this.callbacks.onSelectAction(action),
    });
    this.widgetHeight =
      this.panelHeight + (this.controls.visible ? ACTION_PANEL_GAP + this.controls.panelHeight : 0);
    this.setScroll(this.scrollOffset);
    this.layoutPanel();
  }

  private isCollapsed(id: RulesPreviewSectionId): boolean {
    return usePreferencesStore.getState().collapsedRulesPreviewSections.includes(id);
  }

  private toggleSection(id: RulesPreviewSectionId): void {
    usePreferencesStore.getState().setRulesPreviewSectionCollapsed(id, !this.isCollapsed(id));
    this.rebuild();
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
    });
    header.label = id;
    header.position.set(0, y);
    header.setFocused(this.focusedSection === id);
    parent.addChild(header);
    this.sectionHeaders.push({ id, header });
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
      style: textStyle(this.frame.mutedInk, 12, "600", RULES_BODY_FONT),
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
      background.fill({ color: hexToNum(this.frame.paper) });
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
    const style = oracleTextStyle(this.frame.ink);
    style.fontWeight = "700";
    return this.addOracleAbilityRow(text, y, false, this.bodyContent, style);
  }

  private addOracleAbilityRow(
    text: string,
    y: number,
    planeswalker: boolean,
    parent = this.bodyContent,
    style = oracleTextStyle(this.frame.ink),
  ): number {
    const loyalty = planeswalker ? /^([+\-−]?\d+):\s*(.+)$/.exec(text) : null;
    const content = loyalty?.[2] ?? text;
    const contentX = loyalty ? 43 : 0;
    const row = new Container();
    const rich = new PixiRichText();
    const textHeight = rich.setContent(content, style, this.contentWidth - contentX, 17, 3, {
      parentheticalStyle: oracleTextStyle(this.frame.mutedInk, true),
    });
    const height = Math.max(loyalty ? 34 : 0, textHeight + 4);
    rich.position.set(contentX, 2);
    row.position.set(0, y);
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
    const height = rich.setContent(text, oracleTextStyle(this.frame.mutedInk, true), width, 17, 5);
    const divider = new Graphics();
    divider.moveTo(0, y).lineTo(width, y);
    divider.stroke({ color: hexToNum(this.frame.border), alpha: 0.45, width: 1 });
    parent.addChild(divider);
    rich.position.set(0, y + 8);
    parent.addChild(rich);
    return y + height + 8 + ABILITY_GAP;
  }

  private configureGeometry(landscape: boolean, footerHeight: number, faceCount: number): void {
    this.footerHeight = footerHeight;
    this.panelWidth = landscape ? LANDSCAPE_WIDTH : PORTRAIT_WIDTH;
    this.panelHeight = landscape ? LANDSCAPE_HEIGHT : PORTRAIT_HEIGHT;
    this.faceCount = faceCount;
    this.faceWidth = (this.panelWidth - FACE_GAP * (faceCount - 1)) / faceCount;
    this.headerHeight = landscape ? LANDSCAPE_HEADER_HEIGHT : PORTRAIT_HEADER_HEIGHT;
    this.artX = ART_INSET;
    const artworkHeaderHeight = isFacelessCard(this.spec!.card) ? 0 : PREVIEW_SECTION_HEADER_HEIGHT;
    this.artY = this.headerHeight + 4 + artworkHeaderHeight;
    this.artWidth = this.faceWidth - ART_INSET * 2;
    const texture = this.artSprite.texture;
    this.artHeight = landscape
      ? Math.min(
          LANDSCAPE_ART_HEIGHT,
          texture !== Texture.EMPTY && texture.width > 0
            ? (this.artWidth * texture.height * faceCount) / texture.width
            : LANDSCAPE_ART_HEIGHT,
        )
      : PORTRAIT_ART_HEIGHT;
    this.artHeight =
      artworkHeaderHeight > 0 && this.isCollapsed("artwork")
        ? 0
        : Math.max(0, this.artHeight - artworkHeaderHeight);
    this.typeBandY = this.artY + this.artHeight + 4;
    this.contentX = CONTENT_PAD;
    this.contentWidth = this.faceWidth - CONTENT_PAD * 2;
    this.bodyTop = this.typeBandY + TYPE_HEIGHT;
    this.bodyHeight = this.panelHeight - this.bodyTop - this.footerHeight;
  }

  private drawFooter(
    stats: CardStatPresentation | null,
    loyalty: number | null,
    defense: number | null,
  ): void {
    this.footer.position.set(0, this.panelHeight - this.footerHeight);
    let right = this.panelWidth - CONTENT_PAD;
    if (stats) {
      const value = new Text({
        text: `${stats.power}/${stats.toughness}`,
        style: textStyle(
          stats.state === "neutral" ? this.frame.ink : this.theme.gameTheme.textOnTinted,
          20,
          "700",
          RULES_TITLE_FONT,
        ),
      });
      value.resolution = 2;
      const width = value.width + 24;
      const badge = new Graphics();
      badge.roundRect(right - width, 3, width, 30, 7);
      badge.fill(
        hexToNum(
          stats.state === "neutral" ? this.frame.raised : this.theme.gameTheme.pt[stats.state],
        ),
      );
      badge.stroke({ color: hexToNum(this.frame.border), width: 1 });
      value.position.set(right - width / 2, 18);
      value.anchor.set(0.5);
      this.footer.addChild(badge, value);
      right -= width + 10;
      if (stats.basePower != null && stats.baseToughness != null && stats.state !== "neutral") {
        const base = new Text({
          text: `${stats.basePower}/${stats.baseToughness}`,
          style: textStyle(this.frame.mutedInk, 11, "400", RULES_BODY_FONT),
        });
        base.resolution = 2;
        base.anchor.set(1, 0.5);
        base.position.set(right, 18);
        this.footer.addChild(base);
        right -= base.width + 10;
      }
    }
    if (loyalty != null) this.drawShieldValue(loyalty, "Loyalty", right);
    else if (defense != null) this.drawShieldValue(defense, "Defense", right);
    if (stats?.damage) {
      const damage = new Text({
        text: `${stats.damage} damage`,
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
    const scale = Math.min(
      1,
      (this.viewportWidth - EDGE_PAD * 2) / this.panelWidth,
      (this.viewportHeight - EDGE_PAD * 2) / this.widgetHeight,
    );
    const width = this.panelWidth * scale;
    const height = this.widgetHeight * scale;
    this.container.scale.set(scale);

    let x: number;
    let y: number;
    if (spec.sticky && spec.anchor == null) {
      x = (this.viewportWidth - width) / 2;
      y = (this.viewportHeight - height) / 2;
    } else if (spec.anchor) {
      const right = spec.anchor.x + spec.anchor.width + PANEL_GAP;
      const left = spec.anchor.x - width - PANEL_GAP;
      x = right + width <= this.viewportWidth - EDGE_PAD ? right : Math.max(EDGE_PAD, left);
      y = spec.anchor.y + spec.anchor.height / 2 - height / 2;
    } else {
      x = spec.pointer.x + PANEL_GAP;
      if (x + width > this.viewportWidth - EDGE_PAD) x = spec.pointer.x - width - PANEL_GAP;
      y = spec.pointer.y - height / 2;
    }

    this.container.position.set(
      Math.max(EDGE_PAD, Math.min(x, this.viewportWidth - width - EDGE_PAD)),
      Math.max(EDGE_PAD, Math.min(y, this.viewportHeight - height - EDGE_PAD)),
    );
    this.layoutX = this.container.x;
    this.layoutY = this.container.y;
    this.layoutScale = scale;
    const anchorX = spec.anchor?.x ?? spec.pointer.x;
    const anchorY = spec.anchor?.y ?? spec.pointer.y;
    const anchorWidth = spec.anchor?.width ?? 0;
    const anchorHeight = spec.anchor?.height ?? 0;
    this.controls.position.set(0, this.panelHeight + ACTION_PANEL_GAP);
    this.cardBounds.x = 0;
    this.cardBounds.width = this.panelWidth;
    this.cardBounds.height = this.panelHeight;
    this.controlsBounds.x = this.controls.x;
    this.controlsBounds.y = this.controls.y;
    this.controlsBounds.width = this.panelWidth;
    this.controlsBounds.height = this.controls.panelHeight;
    this.anchorBounds.x = (anchorX - this.container.x) / scale;
    this.anchorBounds.y = (anchorY - this.container.y) / scale;
    this.anchorBounds.width = anchorWidth / scale;
    this.anchorBounds.height = anchorHeight / scale;
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

  private animateOut(): void {
    const spec = this.spec;
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
    this.scrollOffset = Math.max(0, Math.min(offset, maxScroll));
    this.bodyContent.y = -this.scrollOffset;
    this.drawScrollAffordance(maxScroll);
  }

  private drawScrollAffordance(maxScroll: number): void {
    this.scrollTrack.clear();
    this.scrollThumb.clear();
    this.scrollFade.clear();
    if (maxScroll <= 0 || this.bodyHeight <= 0) return;
    const trackX = this.panelWidth - this.contentX + 4;
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
      for (let index = 0; index < this.faceCount; index += 1) {
        this.scrollFade.rect(
          this.contentX + index * (this.faceWidth + FACE_GAP),
          this.bodyTop + this.bodyHeight - 12,
          this.contentWidth,
          12,
        );
      }
      this.scrollFade.fill({ color: hexToNum(this.frame.paper), alpha: 0.45 });
    }
  }

  private async loadCardInfo(): Promise<void> {
    const spec = this.spec;
    if (!spec) return;
    const generation = ++this.cardInfoGeneration;
    if (isFacelessCard(spec.card) || !spec.card.identity.name) {
      this.scryfallInfo = null;
      return;
    }
    try {
      const entry = await useScryfallStore.getState().getCard({
        name: spec.card.identity.name,
        setCode: spec.card.identity.setCode || undefined,
        collectorNumber: spec.card.identity.cardNumber || undefined,
      });
      if (!this.spec || generation !== this.cardInfoGeneration) return;
      this.scryfallInfo = entry.info;
      this.artSprite.texture = Texture.EMPTY;
      this.scrollOffset = 0;
      this.rebuild();
      void this.loadArt();
    } catch {
      if (generation === this.cardInfoGeneration) this.scryfallInfo = null;
    }
  }

  private async loadArt(): Promise<void> {
    const spec = this.spec;
    if (!spec) return;
    const generation = ++this.artGeneration;
    const deckCard = asDeckCard(useGameStore.getState().gameDecks[spec.card.ownerId], spec.card);
    try {
      const faces = resolveCardFaces(this.scryfallInfo ?? undefined);
      const faceIndex: 0 | 1 = spec.showBackFace && faces.isFlippable ? 1 : 0;
      const texture = isFacelessCard(spec.card)
        ? await loadCardBack()
        : await useScryfallStore.getState().getCardTexture(deckCard, "art", faceIndex);
      if (!this.spec || generation !== this.artGeneration || this.artSprite.destroyed) return;
      this.artSprite.texture = texture;
      this.displayedBackFace = faceIndex === 1;
      this.rebuild();
    } catch {
      if (generation === this.artGeneration && !this.artSprite.destroyed) {
        this.artSprite.texture = Texture.EMPTY;
        this.displayedBackFace = spec.showBackFace;
        this.rebuild();
      }
    }
  }

  private fitArt(): void {
    const texture = this.artSprite.texture;
    this.artSprite.visible = this.faceCount === 1;
    this.artFaces.visible = this.faceCount > 1;
    if (texture === Texture.EMPTY || texture.width <= 0 || texture.height <= 0) {
      this.clearArtFaces();
      return;
    }
    if (this.faceCount > 1) {
      const frame = texture.frame;
      const width = frame.width / this.faceCount;
      const first = this.artFaces.children[0]?.texture;
      if (
        this.artFaces.children.length !== this.faceCount ||
        first?.source !== texture.source ||
        first.frame.x !== frame.x ||
        first.frame.y !== frame.y ||
        first.frame.width !== width ||
        first.frame.height !== frame.height
      ) {
        this.clearArtFaces();
        for (let index = 0; index < this.faceCount; index += 1) {
          this.artFaces.addChild(
            new Sprite(
              new Texture({
                source: texture.source,
                frame: new Rectangle(frame.x + index * width, frame.y, width, frame.height),
              }),
            ),
          );
        }
      }
      for (const [index, sprite] of this.artFaces.children.entries()) {
        const scale = Math.min(
          this.artWidth / sprite.texture.width,
          this.artHeight / sprite.texture.height,
        );
        sprite.anchor.set(0.5);
        sprite.position.set(
          index * (this.faceWidth + FACE_GAP) + this.artX + this.artWidth / 2,
          this.artY + this.artHeight / 2,
        );
        sprite.setSize(sprite.texture.width * scale, sprite.texture.height * scale);
      }
      return;
    }
    this.clearArtFaces();
    const fit = this.panelWidth === LANDSCAPE_WIDTH ? Math.min : Math.max;
    const scale = fit(this.artWidth / texture.width, this.artHeight / texture.height);
    this.artSprite.anchor.set(0.5);
    this.artSprite.position.set(this.artX + this.artWidth / 2, this.artY + this.artHeight / 2);
    this.artSprite.setSize(texture.width * scale, texture.height * scale);
  }

  private clearArtFaces(): void {
    this.artFaces.removeChildren().forEach((sprite) => sprite.destroy({ texture: true }));
  }

  private hide(): void {
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    if (this.interactionTimer != null) {
      window.clearTimeout(this.interactionTimer);
      this.interactionTimer = null;
    }
    this.interactiveReady = false;
    if (!this.spec) this.clearHover();
    this.dragStartY = null;
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
    this.clearArtFaces();
    this.actions.destroy();
    this.container.destroy({ children: true });
  }
}
