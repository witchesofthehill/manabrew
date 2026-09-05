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
} from "@/components/game/cardPresentation";
import { getPreviewActionShortcut } from "@/components/game/game.utils";
import { hexToNum } from "@/pixi/colorUtils";
import { PixiRichText } from "@/pixi/cardPreview/PixiRichText";
import { PixiCardRailPreview } from "@/pixi/cardPreview/PixiCardRailPreview";
import { resolveRulesPreviewDisplay } from "@/pixi/cardPreview/rulesCardPreviewPresentation";
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

export class RulesCardPreviewLayer {
  readonly container = new Container();

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
    this.container.on("pointerenter", () => this.callbacks.onPointerEnter());
    this.container.on("pointerleave", () => this.callbacks.onPointerLeave());
    this.container.on("pointerdown", (event: FederatedPointerEvent) => event.stopPropagation());

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

    this.container.addChild(
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
      this.actions,
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
    const scale = this.container.scale.x;
    return (
      x >= this.container.x &&
      x <= this.container.x + this.panelWidth * scale &&
      y >= this.container.y &&
      y <= this.container.y + this.widgetHeight * scale
    );
  }

  focusAction(delta: number): void {
    this.actions.focusAction(delta);
  }

  activateFocusedAction(): void {
    this.actions.activateFocusedAction();
  }

  activateShortcut(shortcut: number): boolean {
    return this.actions.activateShortcut(shortcut);
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

  scrollBy(delta: number, mode: number, y: number): void {
    if (this.actions.visible && (y - this.container.y) / this.container.scale.y >= this.actions.y) {
      this.actions.scrollBy(delta, mode, this.container.scale.y);
      return;
    }
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
    if (display.keywords.length > 0 && !faceColumns) {
      y = this.addKeywordText(display.keywords, y);
    }
    if (display.faceless) {
      y = this.addStaticAbilityRow("Card identity and rules are hidden.", y);
    } else {
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
        for (const text of abilityTextEntries(section.rulesText, progression)) {
          sectionY = this.addOracleAbilityRow(text, sectionY, section.planeswalker, parent);
        }
        if (section.flavorText) {
          sectionY = this.addFlavorText(section.flavorText, sectionY, parent);
        }
        y = faceColumns ? Math.max(y, sectionY) : sectionY;
        if (!faceColumns && display.multipart && sectionIndex < display.sections.length - 1) {
          y += 8;
        }
      }
    }
    if (faceColumns && display.keywords.length > 0) {
      y = this.addKeywordText(display.keywords, y);
    }
    if (progression) {
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
    for (const cost of display.costs) {
      y = this.addStaticAbilityRow(`${cost.label} ${cost.cost}`, y);
    }
    const visibleCounters =
      progression?.rail.kind === "saga"
        ? presentation.counters.filter((counter) => counter.type !== "Lore")
        : presentation.counters;
    if (visibleCounters.length > 0) {
      y = this.addChips(
        visibleCounters.map((counter) => ({
          label: `${counter.type} ×${counter.count}`,
          color: this.theme.gameTheme.counter[counter.colorKey],
        })),
        y + 6,
      );
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
    this.actions.setContent({
      width: this.panelWidth,
      maxHeight: ACTION_PANEL_MAX_HEIGHT,
      theme: this.theme,
      actions: indexedActions,
      controls,
      statuses: presentation.statuses,
      hint: [
        display.otherFace ? "Printed face · live state belongs to the other face" : "",
        spec.sticky && indexedActions.length > 0 ? "↑↓ select · Enter activate · 1–9" : "",
      ]
        .filter(Boolean)
        .join("\n"),
      label: display.otherFace ? "Available on current face" : "Available now",
      onSelectAction: (action) => this.callbacks.onSelectAction(action),
    });
    this.actions.position.set(0, this.panelHeight + ACTION_PANEL_GAP);
    this.actions.visible = this.actions.panelHeight > 0;
    this.widgetHeight =
      this.panelHeight + (this.actions.visible ? ACTION_PANEL_GAP + this.actions.panelHeight : 0);
    this.setScroll(this.scrollOffset);
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
    mana.setContent(manaCost, textStyle(this.frame.ink, 13, "600"), 86, 15, 1);
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

  private addKeywordText(keywords: string[], y: number): number {
    return this.addStaticAbilityRow(
      keywords.map((keyword) => keyword.replace(":", " ")).join(", "),
      y,
    );
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
    this.artY = this.headerHeight + 4;
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
        style: textStyle(this.frame.ink, 20, "700", RULES_TITLE_FONT),
      });
      value.resolution = 2;
      const width = value.width + 24;
      const badge = new Graphics();
      badge.roundRect(right - width, 3, width, 30, 7);
      badge.fill(hexToNum(this.frame.raised));
      badge.stroke({ color: hexToNum(this.frame.border), width: 1 });
      if (stats.state !== "neutral") {
        badge.moveTo(right - width + 9, 30).lineTo(right - 9, 30);
        badge.stroke({ color: hexToNum(this.theme.gameTheme.pt[stats.state]), width: 3 });
      }
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
    this.container.hitArea = new Rectangle(0, 0, this.panelWidth, this.widgetHeight);

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
    this.dragStartY = null;
    this.dragPointerId = null;
    this.actions.reset();
    this.container.visible = false;
    this.container.alpha = 0;
  }

  destroy(): void {
    this.hide();
    this.artGeneration += 1;
    this.cardInfoGeneration += 1;
    this.clearArtFaces();
    this.container.destroy({ children: true });
  }
}
