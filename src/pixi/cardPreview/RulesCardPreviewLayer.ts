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
  type CardPresentation,
  type CardStatPresentation,
  type CardStatusTone,
} from "@/components/game/cardPresentation";
import { getPreviewActionShortcut } from "@/components/game/game.utils";
import { cardFrameTintHex } from "@/themes/gameTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { PixiRichText } from "@/pixi/cardPreview/PixiRichText";
import { PixiCardRailPreview } from "@/pixi/cardPreview/PixiCardRailPreview";
import { resolveRulesPreviewDisplay } from "@/pixi/cardPreview/rulesCardPreviewPresentation";
import { RulesPreviewIdentity } from "@/pixi/cardPreview/RulesPreviewIdentity";
import { loadCardBack } from "@/pixi/CardSprite";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import { useGameStore } from "@/stores/useGameStore";
import { asDeckCard } from "@/lib/decks";
import { isFacelessCard } from "@/lib/gameCard";
import { gsap } from "@/pixi/effects/gsap";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { PREVIEW_TIMING } from "@/lib/cardPreview";

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
  onSelectAction: (action: HandActionOption) => void;
  onDismiss: () => void;
  onFlip: () => void;
}

interface IndexedAction {
  action: HandActionOption;
  index: number;
  shortcut: number;
}

interface ActionRow {
  container: Container;
  top: number;
  height: number;
  shortcut: number;
  activate: () => void;
  setFocused: (focused: boolean) => void;
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
const FOOTER_HEIGHT = 44;
const HELP_FOOTER_HEIGHT = 28;
const CONTENT_PAD = 14;
const PANEL_RADIUS = 13;
const ART_INSET = 8;
const ART_RADIUS = 8;
const LANDSCAPE_ART_HEIGHT = 176;
const FACE_GAP = 8;
const ORACLE_FONT = "Cormorant Garamond, Georgia, serif";
const ORACLE_LINE_HEIGHT = 17;
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
    fontFamily: ORACLE_FONT,
    fontSize: 15,
    fontWeight: "600",
    fontStyle: italic ? "italic" : "normal",
    lineHeight: ORACLE_LINE_HEIGHT,
  });
}

function normalizeAbilityText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"'’.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function abilityTextEntries(
  rulesText: string,
  progression: CardPresentation["progression"],
): string[] {
  const progressionEffects = new Set(
    (progression?.effects ?? []).flatMap((effect) =>
      effect.text.split("\n").map(normalizeAbilityText).filter(Boolean),
    ),
  );
  return rulesText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (
        progression?.rail.kind === "saga" &&
        /^(?:[IVXLCDM]+(?:,\s*[IVXLCDM]+)*)\s+[—–-]\s+/.test(line)
      ) {
        return false;
      }
      if (progressionEffects.has(normalizeAbilityText(line))) return false;
      if (progression?.rail.kind === "class") {
        if (/^.*:\s*Level\s+\d+$/.test(line)) return false;
      }
      return true;
    });
}

function actionText(action: HandActionOption): string {
  const cost = action.cost?.trim();
  if (!cost || normalizeAbilityText(action.label).startsWith(normalizeAbilityText(cost))) {
    return action.label;
  }
  return `${cost}: ${action.label}`;
}

export class RulesCardPreviewLayer {
  readonly container = new Container();

  private theme: Theme;
  private callbacks: RulesCardPreviewCallbacks;
  private background = new Graphics();
  private artBackdrop = new Graphics();
  private artSprite = new Sprite(Texture.EMPTY);
  private artMask = new Graphics();
  private chrome = new Container();
  private bodyScroller = new Container();
  private bodyContent = new Container();
  private bodyMask = new Graphics();
  private scrollTrack = new Graphics();
  private scrollThumb = new Graphics();
  private scrollFade = new Graphics();
  private footer = new Container();
  private spec: RulesCardPreviewSpec | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private panelWidth = PORTRAIT_WIDTH;
  private panelHeight = PORTRAIT_HEIGHT;
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
  private actionRows: ActionRow[] = [];
  private focusedActionIndex = 0;
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
  private dragMoved = false;

  constructor(theme: Theme, callbacks: RulesCardPreviewCallbacks) {
    this.theme = theme;
    this.callbacks = callbacks;
    this.container.visible = false;
    this.container.sortableChildren = true;
    this.container.eventMode = "static";
    this.container.cursor = "default";
    this.container.on("pointerenter", () => this.callbacks.onPointerEnter());
    this.container.on("pointerleave", () => this.callbacks.onPointerLeave());
    this.container.on("pointerdown", (event: FederatedPointerEvent) => event.stopPropagation());

    this.artSprite.mask = this.artMask;
    this.bodyScroller.mask = this.bodyMask;
    this.bodyScroller.addChild(this.bodyContent);
    this.bodyScroller.eventMode = "static";
    this.bodyScroller.on("pointerdown", (event: FederatedPointerEvent) => {
      this.dragMoved = false;
      if (event.pointerType !== "touch" || this.dragPointerId !== null) return;
      this.dragPointerId = event.pointerId;
      this.dragStartY = event.global.y;
      this.dragStartScroll = this.scrollOffset;
    });
    this.bodyScroller.on("globalpointermove", (event: FederatedPointerEvent) => {
      if (this.dragStartY == null || event.pointerId !== this.dragPointerId) return;
      const delta = event.global.y - this.dragStartY;
      if (Math.abs(delta) > 5) this.dragMoved = true;
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

    this.container.addChild(
      this.background,
      this.artBackdrop,
      this.artSprite,
      this.artMask,
      this.chrome,
      this.bodyScroller,
      this.bodyMask,
      this.footer,
      this.scrollTrack,
      this.scrollThumb,
      this.scrollFade,
    );
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
    if (cardChanged) this.forcePortrait = false;
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
      this.focusedActionIndex = 0;
      this.artGeneration += 1;
      if (this.scryfallInfo || isFacelessCard(spec.card)) void this.loadArt();
    }
    if (contentChanged || actionsChanged || faceChanged || previous?.sticky !== spec.sticky) {
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
    const scale = this.container.scale.x;
    return (
      x >= this.container.x &&
      x <= this.container.x + this.panelWidth * scale &&
      y >= this.container.y &&
      y <= this.container.y + this.panelHeight * scale
    );
  }

  focusAction(delta: number): void {
    if (this.actionRows.length === 0) return;
    this.focusedActionIndex =
      (this.focusedActionIndex + delta + this.actionRows.length) % this.actionRows.length;
    this.redrawActionRows();
    this.ensureFocusedActionVisible();
  }

  activateFocusedAction(): void {
    this.actionRows[this.focusedActionIndex]?.activate();
  }

  activateShortcut(shortcut: number): boolean {
    const row = this.actionRows.find((candidate) => candidate.shortcut === shortcut);
    if (!row) return false;
    row.activate();
    return true;
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

  scrollBy(delta: number, mode: number): void {
    const unit =
      mode === 1 ? ORACLE_LINE_HEIGHT : mode === 2 ? this.bodyHeight : 1 / this.container.scale.y;
    this.setScroll(this.scrollOffset + delta * unit);
  }

  private rebuild(): void {
    const spec = this.spec;
    if (!spec || this.viewportWidth <= 0 || this.viewportHeight <= 0) return;
    this.chrome.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.bodyContent.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.footer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.actionRows = [];

    const { appTheme, gameTheme } = this.theme;
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
    const integratedClassLevelUpIndex = classLevelUpIndex >= 0 ? classLevelUpIndex : null;
    const indexedActions: IndexedAction[] = spec.actions.map((action, index) => ({
      action,
      index,
      shortcut: getPreviewActionShortcut(
        index,
        integratedClassLevelUpIndex,
        integratedClassLevelUpIndex === null ? null : nextClassLevel,
      ),
    }));
    const railClassLevelUpAction =
      integratedClassLevelUpIndex === null
        ? undefined
        : indexedActions[integratedClassLevelUpIndex];
    const availableActions = railClassLevelUpAction
      ? indexedActions.filter(({ index }) => index !== railClassLevelUpAction.index)
      : indexedActions;
    const accent = cardFrameTintHex(deckCard.colorIdentity, gameTheme.mana);
    const surface = appTheme.popover;
    const raisedSurface = appTheme.muted;
    this.horizontalFace = display.horizontal;
    this.canFlip = display.flippable;
    const hasFooterValue = display.stats || display.loyalty != null || display.defense != null;
    this.configureGeometry(
      display.horizontal && !this.forcePortrait,
      hasFooterValue ? FOOTER_HEIGHT : spec.sticky ? HELP_FOOTER_HEIGHT : 0,
    );
    const faceColumns = display.multipart && this.panelWidth === LANDSCAPE_WIDTH;

    this.artBackdrop.clear();
    this.artBackdrop.roundRect(this.artX, this.artY, this.artWidth, this.artHeight, ART_RADIUS);
    this.artBackdrop.fill({ color: hexToNum(appTheme.muted), alpha: 1 });

    this.artMask.clear();
    if (faceColumns) {
      const width = (this.artWidth - FACE_GAP) / display.sections.length;
      for (let index = 0; index < display.sections.length; index += 1) {
        this.artMask.roundRect(
          this.artX + index * (width + FACE_GAP),
          this.artY,
          width,
          this.artHeight,
          ART_RADIUS,
        );
      }
    } else {
      this.artMask.roundRect(this.artX, this.artY, this.artWidth, this.artHeight, ART_RADIUS);
    }
    this.artMask.fill(hexToNum(appTheme.popover));
    this.fitArt();

    const typeBand = new Graphics();
    this.chrome.addChild(typeBand);
    const identities = faceColumns ? display.sections : [display];
    const identityWidth =
      (this.panelWidth - FACE_GAP * (identities.length - 1)) / identities.length;
    let typeHeight = TYPE_HEIGHT;
    for (const [index, section] of identities.entries()) {
      const identity = new RulesPreviewIdentity({
        section,
        width: identityWidth,
        headerHeight: this.headerHeight,
        typeY: this.typeBandY,
        contentPad: CONTENT_PAD,
        fontFamily: ORACLE_FONT,
        fontSize: faceColumns ? 20 : this.panelWidth === LANDSCAPE_WIDTH ? 22 : 24,
        info: this.scryfallInfo,
        setCode: spec.card.identity.setCode,
        faceless: display.faceless,
        theme: this.theme,
      });
      identity.x = index * (identityWidth + FACE_GAP);
      typeHeight = Math.max(typeHeight, identity.typeHeight);
      this.chrome.addChild(identity);
    }
    this.bodyTop = this.typeBandY + typeHeight;
    this.bodyHeight = this.panelHeight - this.bodyTop - this.footerHeight;
    typeBand.rect(0, this.typeBandY, this.panelWidth, typeHeight);
    typeBand.fill({ color: hexToNum(raisedSurface), alpha: 1 });

    let controlX = this.artX + 8;
    if (display.horizontal) {
      const rotate = this.createControl(this.forcePortrait ? "LANDSCAPE · F" : "ROTATE · F", () =>
        this.activatePrimaryTransform(),
      );
      rotate.position.set(controlX, this.artY + 8);
      controlX += rotate.width + 6;
      this.chrome.addChild(rotate);
    }
    if (display.flippable) {
      const shortcut = display.horizontal ? "" : " · F";
      const flip = this.createControl(
        `FLIP ${display.faceIndex === 0 ? "BACK" : "FRONT"}${shortcut}`,
        () => this.callbacks.onFlip(),
      );
      flip.position.set(
        Math.max(controlX, this.artX + this.artWidth - flip.width - 8),
        this.artY + 8,
      );
      this.chrome.addChild(flip);
    }

    this.bodyScroller.position.set(this.contentX, this.bodyTop);

    let y = 10;
    if (display.otherFace) {
      y = this.addSectionLabel("OTHER FACE · PRINTED TEXT", y, accent);
    }
    if (display.keywords.length > 0) {
      y = this.addKeywordBadges(display.keywords, y);
      y += 7;
    }

    if (display.faceless) {
      y = this.addStaticAbilityRow("Card identity and rules are hidden.", y);
    } else {
      const startY = y;
      for (const [sectionIndex, section] of display.sections.entries()) {
        let sectionY = faceColumns ? startY : y;
        const width = faceColumns ? identityWidth - CONTENT_PAD * 2 : this.contentWidth;
        const parent = faceColumns ? new Container() : this.bodyContent;
        if (faceColumns) {
          parent.x = sectionIndex * (identityWidth + FACE_GAP);
          this.bodyContent.addChild(parent);
        } else if (display.multipart) {
          sectionY = this.addFaceHeading(
            section.name,
            section.manaCost,
            section.typeLine,
            sectionY,
            accent,
          );
        }
        for (const text of abilityTextEntries(section.rulesText, progression)) {
          sectionY = this.addOracleAbilityRow(text, sectionY, section.planeswalker, parent, width);
        }
        if (section.flavorText)
          sectionY = this.addFlavorText(section.flavorText, sectionY, parent, width);
        y = faceColumns ? Math.max(y, sectionY) : sectionY;
        if (!faceColumns && display.multipart && sectionIndex < display.sections.length - 1) y += 8;
      }
    }
    y += 8;

    if (progression) {
      const railInteractions =
        nextClassLevel && railClassLevelUpAction
          ? [
              {
                position: nextClassLevel,
                shortcut: railClassLevelUpAction.shortcut,
                label: railClassLevelUpAction.action.label,
                onActivate: () => this.callbacks.onSelectAction(railClassLevelUpAction.action),
              },
            ]
          : [];
      const rail = new PixiCardRailPreview({
        state: progression.rail,
        effects: progression.effects,
        interactions: railInteractions,
        width: this.contentWidth,
        theme: this.theme,
      });
      rail.position.set(0, y);
      this.bodyContent.addChild(rail);
      for (const interactionRow of rail.interactionRows) {
        const focusIndex = this.actionRows.length;
        interactionRow.container.on("pointerenter", () => {
          this.focusedActionIndex = focusIndex;
          this.redrawActionRows();
        });
        interactionRow.container.on("pointertap", (event: FederatedPointerEvent) => {
          event.stopPropagation();
          if (!this.dragMoved) interactionRow.activate();
        });
        this.actionRows.push({
          container: interactionRow.container,
          top: y + interactionRow.top,
          height: interactionRow.height,
          shortcut: interactionRow.shortcut,
          activate: interactionRow.activate,
          setFocused: interactionRow.setFocused,
        });
      }
      y += rail.contentHeight + 8;
    }

    if (availableActions.length > 0) {
      y = this.addSectionLabel(
        display.otherFace ? "AVAILABLE ON CURRENT FACE" : "AVAILABLE NOW",
        y,
        appTheme.ring,
      );
      y = this.addActionRows(availableActions, y, appTheme.ring);
      y += 8;
    }

    if (display.costs.length > 0) {
      y = this.addSectionLabel("ALTERNATE COSTS", y, accent);
      for (const cost of display.costs) {
        y = this.addStaticAbilityRow(`${cost.label} ${cost.cost}`, y);
      }
      y += 4;
    }

    if (presentation.statuses.length > 0) {
      y = this.addChips(
        presentation.statuses.map((status) => ({
          label: status.label,
          color: this.statusColor(status.tone),
        })),
        y,
      );
      y += 10;
    }

    const visibleCounters =
      progression?.rail.kind === "saga"
        ? presentation.counters.filter((counter) => counter.type !== "Lore")
        : presentation.counters;
    if (visibleCounters.length > 0) {
      y = this.addSectionLabel("COUNTERS", y, accent);
      y = this.addChips(
        visibleCounters.map((counter) => ({
          label: `${counter.type} ×${counter.count}`,
          color: gameTheme.counter[counter.colorKey],
        })),
        y,
      );
      y += 10;
    }

    this.contentHeight = y;
    this.background.clear();
    this.background.roundRect(0, 0, this.panelWidth, this.panelHeight, PANEL_RADIUS);
    this.background.fill({ color: hexToNum(surface), alpha: 1 });

    this.bodyScroller.hitArea = new Rectangle(0, 0, this.contentWidth, this.bodyHeight);
    this.bodyMask.clear();
    this.bodyMask.rect(this.contentX, this.bodyTop, this.contentWidth, this.bodyHeight);
    this.bodyMask.fill(hexToNum(appTheme.popover));

    this.drawFooter(display.stats, display.loyalty, display.defense);
    this.setScroll(this.scrollOffset);
    this.redrawActionRows();
    this.layoutPanel();
  }

  private createControl(label: string, activate: () => void): Container {
    const control = new Container();
    const text = new Text({
      text: label,
      style: textStyle(this.theme.appTheme["popover-foreground"], 10, "700"),
    });
    text.resolution = 2;
    const background = new Graphics();
    const width = text.width + 12;
    const height = 28;
    background.roundRect(0, 0, width, height, 9);
    background.fill({ color: hexToNum(this.theme.appTheme.muted), alpha: 0.96 });
    text.position.set(6, 7);
    control.addChild(background, text);
    control.eventMode = "static";
    control.cursor = "pointer";
    control.hitArea = new Rectangle(-4, -6, width + 8, height + 12);
    control.on("pointerdown", () => {
      this.dragMoved = false;
    });
    control.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      if (!this.dragMoved) activate();
    });
    return control;
  }

  private addSectionLabel(label: string, y: number, accent: string): number {
    const sectionStyle = textStyle(accent, 10, "700");
    sectionStyle.letterSpacing = 0.8;
    const text = new Text({ text: label, style: sectionStyle });
    text.resolution = 2;
    text.position.set(2, y);
    this.bodyContent.addChild(text);
    return y + 20;
  }

  private addFaceHeading(
    name: string,
    manaCost: string,
    typeLine: string,
    y: number,
    accent: string,
  ): number {
    const nameText = new Text({
      text: name,
      style: new TextStyle({
        fill: this.theme.appTheme["popover-foreground"],
        fontFamily: ORACLE_FONT,
        fontSize: 17,
        fontWeight: "700",
        wordWrap: true,
        wordWrapWidth: this.contentWidth - 98,
        lineHeight: 18,
      }),
    });
    nameText.resolution = 2;
    nameText.position.set(2, y);
    const mana = new PixiRichText();
    mana.setContent(
      manaCost,
      textStyle(this.theme.appTheme["popover-foreground"], 13, "600"),
      86,
      15,
      1,
    );
    mana.position.set(this.contentWidth - mana.width, y + 1);
    const type = new Text({
      text: typeLine,
      style: textStyle(this.theme.appTheme["muted-foreground"], 10, "600", ORACLE_FONT),
    });
    type.resolution = 2;
    type.position.set(2, y + Math.max(20, nameText.height) + 2);
    const marker = new Graphics();
    marker.rect(0, y, 2, Math.max(36, nameText.height + 16));
    marker.fill({ color: hexToNum(accent), alpha: 0.9 });
    nameText.x = 8;
    type.x = 8;
    this.bodyContent.addChild(marker, nameText, mana, type);
    return y + Math.max(42, nameText.height + 24);
  }

  private addKeywordBadges(keywords: string[], y: number): number {
    let x = 0;
    let rowHeight = 0;
    for (const keyword of keywords) {
      const colonIndex = keyword.indexOf(":");
      const label = colonIndex === -1 ? keyword : keyword.slice(0, colonIndex);
      const cost = colonIndex === -1 ? "" : keyword.slice(colonIndex + 1);
      const rich = new PixiRichText();
      const height = rich.setContent(
        `${label}${cost ? ` ${cost}` : ""}`.toUpperCase(),
        new TextStyle({
          fill: this.theme.appTheme["secondary-foreground"],
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.4,
          lineHeight: 13,
        }),
        this.contentWidth - 16,
        14,
        1,
      );
      const width = Math.min(this.contentWidth, rich.width + 16);
      const badgeHeight = Math.max(21, height + 6);
      if (x > 0 && x + width > this.contentWidth) {
        x = 0;
        y += rowHeight + 5;
        rowHeight = 0;
      }
      const badge = new Container();
      const background = new Graphics();
      background.roundRect(0, 0, width, badgeHeight, 4);
      background.fill({
        color: hexToNum(this.theme.appTheme.secondary),
        alpha: 1,
      });
      rich.position.set(8, 3);
      badge.position.set(x, y);
      badge.addChild(background, rich);
      this.bodyContent.addChild(badge);
      x += width + 5;
      rowHeight = Math.max(rowHeight, badgeHeight);
    }
    return y + rowHeight;
  }

  private addChips(items: Array<{ label: string; color: string }>, y: number): number {
    let x = 0;
    let rowHeight = 0;
    for (const item of items) {
      const label = new Text({
        text: item.label.toUpperCase(),
        style: textStyle(this.theme.appTheme["secondary-foreground"], 10, "700"),
      });
      label.resolution = 2;
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
      background.fill({ color: hexToNum(item.color), alpha: 0.88 });
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
    return this.addOracleAbilityRow(text, y, false);
  }

  private addOracleAbilityRow(
    text: string,
    y: number,
    planeswalker: boolean,
    parent = this.bodyContent,
    width = this.contentWidth,
  ): number {
    const loyalty = planeswalker ? /^([+\-−]?\d+):\s*(.+)$/.exec(text) : null;
    const content = loyalty?.[2] ?? text;
    const contentX = loyalty ? 43 : 4;
    const row = new Container();
    const rich = new PixiRichText();
    const textHeight = rich.setContent(
      content,
      oracleTextStyle(this.theme.appTheme["popover-foreground"]),
      width - contentX - 4,
      17,
      3,
      {
        parentheticalStyle: oracleTextStyle(this.theme.appTheme["muted-foreground"], true),
      },
    );
    const height = Math.max(loyalty ? 34 : 0, textHeight + 8);
    rich.position.set(contentX, 4);
    row.position.set(0, y);
    row.addChild(rich);
    if (loyalty) {
      const badge = new Graphics();
      badge.poly([4, 7, 34, 7, 37, height / 2, 34, height - 7, 4, height - 7, 1, height / 2]);
      badge.fill({
        color: hexToNum(this.theme.gameTheme.counter.loyalty),
        alpha: 0.94,
      });
      const value = new Text({
        text: loyalty[1]!.replace("-", "−"),
        style: textStyle(this.theme.gameTheme.textOnTinted, 12, "700"),
      });
      value.resolution = 2;
      value.anchor.set(0.5);
      value.position.set(19, height / 2);
      row.addChild(badge, value);
    }
    parent.addChild(row);
    return y + height + 5;
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
      oracleTextStyle(this.theme.appTheme["muted-foreground"], true),
      width - 8,
      17,
      5,
    );
    rich.position.set(4, y + 4);
    parent.addChild(rich);
    return y + height + 14;
  }

  private addActionRows(actions: IndexedAction[], y: number, accent: string): number {
    actions.forEach(({ action, shortcut }) => {
      const row = new Container();
      const background = new Graphics();
      const keyBackground = new Graphics();
      keyBackground.roundRect(9, 9, 23, 23, 6);
      keyBackground.fill({ color: hexToNum(accent), alpha: 0.95 });
      const key = new Text({
        text: String(shortcut),
        style: textStyle(this.theme.appTheme["primary-foreground"], 12, "700"),
      });
      key.resolution = 2;
      key.anchor.set(0.5);
      key.position.set(20.5, 20.5);
      const label = new PixiRichText();
      const labelHeight = label.setContent(
        actionText(action),
        oracleTextStyle(this.theme.appTheme["popover-foreground"]),
        this.contentWidth - 55,
        17,
        4,
        {
          parentheticalStyle: oracleTextStyle(this.theme.appTheme["muted-foreground"], true),
        },
      );
      label.position.set(43, 9);
      const height = Math.max(41, labelHeight + 18);
      row.position.set(0, y);
      row.hitArea = new Rectangle(0, 0, this.contentWidth, height);
      row.eventMode = "static";
      row.cursor = "pointer";
      row.addChild(background, keyBackground, key, label);
      const focusIndex = this.actionRows.length;
      row.on("pointerenter", () => {
        this.focusedActionIndex = focusIndex;
        this.redrawActionRows();
      });
      const activate = () => this.callbacks.onSelectAction(action);
      row.on("pointertap", (event: FederatedPointerEvent) => {
        event.stopPropagation();
        if (!this.dragMoved) activate();
      });
      const setFocused = (focused: boolean) => {
        const ring = this.theme.appTheme.ring;
        background.clear();
        background.roundRect(0, 0, this.contentWidth, height, 9);
        background.fill({
          color: hexToNum(focused ? ring : this.theme.appTheme.muted),
          alpha: focused ? 0.34 : 0.5,
        });
      };
      setFocused(false);
      this.bodyContent.addChild(row);
      this.actionRows.push({
        container: row,
        top: y,
        height,
        shortcut,
        activate,
        setFocused,
      });
      y += height + 6;
    });
    return y;
  }

  private redrawActionRows(): void {
    this.focusedActionIndex = Math.min(
      this.focusedActionIndex,
      Math.max(0, this.actionRows.length - 1),
    );
    this.actionRows.forEach((row, index) => {
      row.setFocused(index === this.focusedActionIndex);
    });
  }

  private configureGeometry(landscape: boolean, footerHeight: number): void {
    this.footerHeight = footerHeight;
    this.panelWidth = landscape ? LANDSCAPE_WIDTH : PORTRAIT_WIDTH;
    this.panelHeight = landscape ? LANDSCAPE_HEIGHT : PORTRAIT_HEIGHT;
    this.headerHeight = landscape ? LANDSCAPE_HEADER_HEIGHT : PORTRAIT_HEADER_HEIGHT;
    this.artX = ART_INSET;
    this.artY = this.headerHeight;
    this.artWidth = this.panelWidth - ART_INSET * 2;
    const texture = this.artSprite.texture;
    this.artHeight = landscape
      ? Math.min(
          LANDSCAPE_ART_HEIGHT,
          texture !== Texture.EMPTY && texture.width > 0
            ? (this.artWidth * texture.height) / texture.width
            : LANDSCAPE_ART_HEIGHT,
        )
      : PORTRAIT_ART_HEIGHT;
    this.typeBandY = this.artY + this.artHeight;
    this.contentX = CONTENT_PAD;
    this.contentWidth = this.panelWidth - CONTENT_PAD * 2;
    this.bodyTop = this.typeBandY + TYPE_HEIGHT;
    this.bodyHeight = this.panelHeight - this.bodyTop - this.footerHeight;
  }

  private drawFooter(
    stats: CardStatPresentation | null,
    loyalty: number | null,
    defense: number | null,
  ): void {
    if (this.footerHeight === 0) return;
    const top = this.panelHeight - this.footerHeight;
    this.footer.position.set(0, top);
    const background = new Graphics();
    background.roundRect(0, 0, this.panelWidth, this.footerHeight, PANEL_RADIUS);
    background.fill({
      color: hexToNum(this.theme.appTheme.popover),
      alpha: 1,
    });
    background.rect(0, 0, this.panelWidth, PANEL_RADIUS);
    background.fill({ color: hexToNum(this.theme.appTheme.popover), alpha: 1 });
    this.footer.addChild(background);

    if (this.spec?.sticky) {
      const shortcuts = this.actionRows.length > 0 ? ["↑↓", "ENTER", "1–9", "ESC"] : ["ESC"];
      if (this.horizontalFace || this.canFlip) shortcuts.push("F");
      const help = new Text({
        text: shortcuts.join(" · "),
        style: textStyle(this.theme.appTheme["muted-foreground"], 8, "600"),
      });
      help.resolution = 2;
      help.position.set(CONTENT_PAD, 5);
      this.footer.addChild(help);
    }

    if (stats?.damage) {
      const damage = new Text({
        text: `DAMAGE ${stats.damage}`,
        style: textStyle(this.theme.gameTheme.pt.lethal, 11, "700"),
      });
      damage.resolution = 2;
      damage.position.set(CONTENT_PAD, this.spec?.sticky ? 23 : 20);
      this.footer.addChild(damage);
    }

    if (loyalty != null) {
      this.drawShieldValue(loyalty, "LOYALTY", this.theme.gameTheme.counter.loyalty);
    } else if (defense != null) {
      this.drawShieldValue(defense, "DEFENSE", this.theme.gameTheme.counter.shield);
    }

    if (stats) {
      const color = this.theme.gameTheme.pt[stats.state];
      const value = new Text({
        text: `${stats.power}/${stats.toughness}`,
        style: textStyle(this.theme.appTheme["card-foreground"], 18, "700"),
      });
      value.resolution = 2;
      const width = value.width + 20;
      const badge = new Graphics();
      badge.roundRect(this.panelWidth - CONTENT_PAD - width, 7, width, 30, 8);
      badge.fill({ color: hexToNum(color), alpha: 0.94 });
      value.position.set(this.panelWidth - CONTENT_PAD - width / 2, 22);
      value.anchor.set(0.5);
      this.footer.addChild(badge, value);

      if (stats.basePower != null && stats.baseToughness != null && stats.state !== "neutral") {
        const base = new Text({
          text: `${stats.basePower}/${stats.baseToughness}`,
          style: textStyle(this.theme.appTheme["muted-foreground"], 10, "500"),
        });
        base.resolution = 2;
        base.anchor.set(1, 0.5);
        base.position.set(this.panelWidth - CONTENT_PAD - width - 7, 22);
        this.footer.addChild(base);
      }
    }
  }

  private drawShieldValue(value: number, label: string, color: string): void {
    const right = this.panelWidth - CONTENT_PAD;
    const badgeWidth = 42;
    const badgeHeight = 36;
    const badgeLeft = right - badgeWidth;
    const badge = new Graphics();
    badge.poly([
      badgeLeft,
      5,
      right,
      5,
      right - 3,
      29,
      right - badgeWidth / 2,
      badgeHeight + 2,
      badgeLeft + 3,
      29,
    ]);
    badge.fill({ color: hexToNum(color), alpha: 0.94 });
    const valueText = new Text({
      text: String(value),
      style: textStyle(this.theme.gameTheme.textOnTinted, 18, "700"),
    });
    valueText.resolution = 2;
    valueText.anchor.set(0.5);
    valueText.position.set(right - badgeWidth / 2, 21);
    const labelText = new Text({
      text: label,
      style: textStyle(color, 10, "700"),
    });
    labelText.resolution = 2;
    labelText.anchor.set(1, 0.5);
    labelText.position.set(badgeLeft - 8, 21);
    this.footer.addChild(badge, labelText, valueText);
  }

  private statusColor(tone: CardStatusTone): string {
    const theme = this.theme.gameTheme;
    if (tone in theme.cardStatus) {
      return theme.cardStatus[tone as keyof typeof theme.cardStatus];
    }
    if (tone === "danger") return theme.pt.lethal;
    if (tone === "positive") return theme.success;
    if (tone === "ring") return theme.badges.ring;
    if (tone === "accent") return theme.cardRing;
    return theme.counter.default;
  }

  private layoutPanel(): void {
    const spec = this.spec;
    if (!spec || this.viewportWidth <= 0 || this.viewportHeight <= 0) return;
    const scale = Math.min(
      1,
      (this.viewportWidth - EDGE_PAD * 2) / this.panelWidth,
      (this.viewportHeight - EDGE_PAD * 2) / this.panelHeight,
    );
    const width = this.panelWidth * scale;
    const height = this.panelHeight * scale;
    this.container.scale.set(scale);
    this.container.hitArea = new Rectangle(0, 0, this.panelWidth, this.panelHeight);

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
      if (this.spec?.phase === "open" && !this.spec.suppressed) this.interactiveReady = true;
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
    const trackX = this.contentX + this.contentWidth + 4;
    const trackY = this.bodyTop + 5;
    const trackHeight = Math.max(12, this.bodyHeight - 10);
    const thumbHeight = Math.max(28, trackHeight * (this.bodyHeight / this.contentHeight));
    const thumbTravel = Math.max(0, trackHeight - thumbHeight);
    const thumbY = trackY + thumbTravel * (this.scrollOffset / maxScroll);
    this.scrollTrack.roundRect(trackX, trackY, 2, trackHeight, 1);
    this.scrollTrack.fill({
      color: hexToNum(this.theme.appTheme.muted),
      alpha: 0.7,
    });
    this.scrollThumb.roundRect(trackX - 1, thumbY, 4, thumbHeight, 2);
    this.scrollThumb.fill({
      color: hexToNum(this.theme.appTheme["muted-foreground"]),
      alpha: 0.85,
    });
    if (this.scrollOffset < maxScroll - 1) {
      this.scrollFade.rect(
        this.contentX,
        this.bodyTop + this.bodyHeight - 18,
        this.contentWidth,
        18,
      );
      this.scrollFade.fill({
        color: hexToNum(this.theme.appTheme.muted),
        alpha: 0.36,
      });
    }
  }

  private ensureFocusedActionVisible(): void {
    const row = this.actionRows[this.focusedActionIndex];
    if (!row) return;
    if (row.top < this.scrollOffset) this.setScroll(row.top - 8);
    else if (row.top + row.height > this.scrollOffset + this.bodyHeight) {
      this.setScroll(row.top + row.height - this.bodyHeight + 8);
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
    if (!texture || texture === Texture.EMPTY || texture.width <= 0 || texture.height <= 0) return;
    const fit = this.panelWidth === LANDSCAPE_WIDTH ? Math.min : Math.max;
    const scale = fit(this.artWidth / texture.width, this.artHeight / texture.height);
    this.artSprite.anchor.set(0.5);
    this.artSprite.position.set(this.artX + this.artWidth / 2, this.artY + this.artHeight / 2);
    this.artSprite.setSize(texture.width * scale, texture.height * scale);
  }

  private hide(): void {
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    if (this.interactionTimer != null) {
      window.clearTimeout(this.interactionTimer);
      this.interactionTimer = null;
    }
    this.interactiveReady = false;
    this.dragStartY = null;
    this.dragPointerId = null;
    this.dragMoved = false;
    this.container.visible = false;
    this.container.alpha = 0;
  }

  destroy(): void {
    this.hide();
    this.artGeneration += 1;
    this.cardInfoGeneration += 1;
    this.container.destroy({ children: true });
  }
}
