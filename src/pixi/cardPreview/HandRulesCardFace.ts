import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
  type DestroyOptions,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
  type FillGradient,
} from "pixi.js";
import type { CardDto } from "@/protocol/game";
import type { Theme } from "@/hooks/useTheme";
import type { ScryfallCard } from "@/types/scryfall";
import { deriveCardPresentation } from "@/components/game/cardPresentation";
import { isFacelessCard } from "@/lib/gameCard";
import { hexToNum } from "@/pixi/colorUtils";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import { asDeckCard } from "@/lib/decks";
import { useGameStore } from "@/stores/useGameStore";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { gsap } from "@/pixi/effects/gsap";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { PixiRichText } from "./PixiRichText";
import { RulesPreviewIdentity } from "./RulesPreviewIdentity";
import { RulesPreviewActions } from "./RulesPreviewActions";
import {
  PREVIEW_SECTION_HEADER_HEIGHT,
  RulesPreviewSectionHeader,
} from "./RulesPreviewSectionHeader";
import {
  resolveRulesPreviewDisplay,
  rulesEntryMatchesStackAbility,
  rulesTextEntries,
  type RulesPreviewDisplay,
} from "./rulesCardPreviewPresentation";
import {
  drawRulesPreviewFrame,
  drawRulesStatBadge,
  resolveRulesPreviewFrame,
  RULES_BODY_FONT,
  RULES_CARD_CONSTRAINTS,
  RULES_TITLE_FONT,
  RULES_TITLE_ART_RADIUS,
  type RulesPreviewFrameStyle,
} from "./rulesPreviewFrame";

const PORTRAIT_WIDTH = RULES_CARD_CONSTRAINTS.width;
const PORTRAIT_HEIGHT = RULES_CARD_CONSTRAINTS.height;
const LANDSCAPE_WIDTH = PORTRAIT_HEIGHT;
const LANDSCAPE_HEIGHT = PORTRAIT_WIDTH;
const HEADER_HEIGHT = 52;
const PORTRAIT_ART_HEIGHT = 122;
const LANDSCAPE_ART_HEIGHT = 82;
const ART_INSET = 8;
const CONTENT_PAD = 16;
const FOOTER_HEIGHT = 44;
const FRAME_BOTTOM_PAD = 16;
const RULES_FONT_MAX = 21;
const RULES_FONT_MIN = 16;
const RULES_LINE_GAP = 3;
const STACK_RULES_FONT_SIZE = 19;
const BODY_TOP_GAP = 6;
const ACTIONS_MAX_HEIGHT = 136;
const ACTIONS_CONTENT_SCALE = 1.3;
const SECTION_GAP = 6;
const SECTION_HEADER_FONT_SIZE = 15;
const FADE_HEIGHT = 18;
const STACK_RULES_ENTRY_GAP = 8;
const STACK_RULES_ENTRY_PAD = 6;
const STACK_RULES_SCROLL_GUTTER = 8;
const STACK_RULES_PULSE_S = 0.9;
type HandRulesSectionId = "actions" | "rules" | "flavor";

export class HandRulesCardFace extends Container {
  private root = new Container();
  private info: ScryfallCard | null = null;
  private lookupGeneration = 0;
  private artTexture = Texture.EMPTY;
  private artGeneration = 0;
  private actions: HandActionOption[] = [];
  private onSelectAction: ((action: HandActionOption) => void) | null = null;
  private actionsCollapsed = true;
  private rulesCollapsed = false;
  private flavorCollapsed = true;
  private card: CardDto;
  private faceIndex: 0 | 1;
  private slotWidth: number;
  private slotHeight: number;
  private deckLayout?: string;
  private theme: Theme;
  private frameGradient: FillGradient | null = null;
  private highlightedEffect = "";
  private highlightedEffectScroll: number | null = null;
  private highlightedEffectTween: gsap.core.Tween | null = null;

  constructor(
    card: CardDto,
    faceIndex: 0 | 1,
    width: number,
    height: number,
    deckLayout: string | undefined,
    theme: Theme,
  ) {
    super();
    this.card = card;
    this.faceIndex = faceIndex;
    this.slotWidth = width;
    this.slotHeight = height;
    this.deckLayout = deckLayout;
    this.theme = theme;
    this.eventMode = "passive";
    this.addChild(this.root);
    this.resolveInfo();
    this.rebuild();
    void this.loadArt();
  }

  setContent(
    card: CardDto,
    faceIndex: 0 | 1,
    width: number,
    height: number,
    deckLayout: string | undefined,
  ): void {
    const lookupChanged =
      card.identity.name !== this.card.identity.name ||
      card.identity.setCode !== this.card.identity.setCode ||
      card.identity.cardNumber !== this.card.identity.cardNumber;
    const faceChanged = faceIndex !== this.faceIndex;
    this.card = card;
    this.faceIndex = faceIndex;
    this.slotWidth = width;
    this.slotHeight = height;
    this.deckLayout = deckLayout;
    if (lookupChanged) this.resolveInfo();
    if (lookupChanged || faceChanged) {
      this.artTexture = Texture.EMPTY;
      void this.loadArt();
    }
    this.rebuild();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.rebuild();
  }
  setActions(
    actions: HandActionOption[],
    onSelectAction: ((action: HandActionOption) => void) | null,
  ): void {
    const hadActions = this.actions.length > 0 && this.onSelectAction !== null;
    const hasActions = actions.length > 0 && onSelectAction !== null;
    this.actions = actions;
    this.onSelectAction = onSelectAction;
    if (hasActions && !hadActions) {
      this.actionsCollapsed = false;
      this.rulesCollapsed = true;
      this.flavorCollapsed = true;
    } else if (!hasActions && hadActions) {
      this.actionsCollapsed = true;
      this.rulesCollapsed = false;
      this.flavorCollapsed = true;
    }
    this.rebuild();
  }

  setHighlightedEffect(text: string): void {
    if (this.highlightedEffect === text) return;
    this.highlightedEffect = text;
    this.highlightedEffectScroll = null;
    this.rebuild();
  }

  private resolveInfo(): void {
    const generation = ++this.lookupGeneration;
    const lookup = {
      name: this.card.identity.name,
      setCode: this.card.identity.setCode || undefined,
      collectorNumber: this.card.identity.cardNumber || undefined,
    };
    this.info = peekCard(useScryfallStore.getState().cards, lookup);
    if (this.info || isFacelessCard(this.card) || !lookup.name) return;
    void useScryfallStore
      .getState()
      .getCard(lookup)
      .then((entry) => {
        if (this.destroyed || generation !== this.lookupGeneration) return;
        this.info = entry.info;
        this.rebuild();
      })
      .catch(() => undefined);
  }
  private async loadArt(): Promise<void> {
    const generation = ++this.artGeneration;
    if (isFacelessCard(this.card)) {
      this.artTexture = Texture.EMPTY;
      return;
    }
    const deckCard = asDeckCard(useGameStore.getState().gameDecks[this.card.ownerId], this.card);
    try {
      const texture = await useScryfallStore
        .getState()
        .getCardTexture(deckCard, "art", this.faceIndex);
      if (this.destroyed || generation !== this.artGeneration) return;
      this.artTexture = texture;
      this.rebuild();
    } catch {
      if (this.destroyed || generation !== this.artGeneration) return;
      this.artTexture = Texture.EMPTY;
      this.rebuild();
    }
  }

  private rebuild(): void {
    this.highlightedEffectTween?.kill();
    this.highlightedEffectTween = null;
    this.root.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.frameGradient?.destroy();
    this.frameGradient = null;
    const landscape = this.slotWidth > this.slotHeight;
    const designWidth = landscape ? LANDSCAPE_WIDTH : PORTRAIT_WIDTH;
    const designHeight = landscape ? LANDSCAPE_HEIGHT : PORTRAIT_HEIGHT;
    this.root.scale.set(this.slotWidth / designWidth, this.slotHeight / designHeight);

    const presentation = deriveCardPresentation({ ...this.card, zoneId: "hand" });
    const deckCard = asDeckCard(useGameStore.getState().gameDecks[this.card.ownerId], this.card);
    const display = resolveRulesPreviewDisplay({
      card: this.card,
      presentation,
      info: this.info,
      deckLayout: this.deckLayout,
      showBackFace: this.faceIndex === 1,
      faceless: isFacelessCard(this.card),
    });
    const frame = resolveRulesPreviewFrame(
      this.theme,
      deckCard.colorIdentity ?? this.info?.color_identity,
    );
    this.frameGradient = frame.titleGradient;
    const background = new Graphics();
    const footerHeight =
      display.stats || display.loyalty != null || display.defense != null
        ? FOOTER_HEIGHT
        : FRAME_BOTTOM_PAD;
    const artHeight = display.faceless ? 0 : landscape ? LANDSCAPE_ART_HEIGHT : PORTRAIT_ART_HEIGHT;
    const artY = HEADER_HEIGHT - 4;
    const typeY = artY + artHeight + 4;
    const identity = new RulesPreviewIdentity({
      section: display,
      width: designWidth,
      headerHeight: HEADER_HEIGHT,
      typeY,
      contentPad: CONTENT_PAD,
      fontFamily: RULES_TITLE_FONT,
      fontSize: 26,
      info: this.info,
      setCode: this.card.identity.setCode,
      faceless: display.faceless,
      theme: this.theme,
      frame,
    });
    const bodyTop = typeY + identity.typeHeight + BODY_TOP_GAP;
    drawRulesPreviewFrame(background, frame, {
      x: 0,
      y: 0,
      width: designWidth,
      height: designHeight,
      headerHeight: HEADER_HEIGHT,
      artInset: ART_INSET,
      artY,
      artHeight,
      typeY,
      typeHeight: identity.typeHeight,
      footerHeight,
    });

    const artWidth = designWidth - ART_INSET * 2;
    const artwork = new Sprite(this.artTexture);
    const artMask = new Graphics();
    artMask
      .roundRect(ART_INSET, artY, artWidth, artHeight, RULES_TITLE_ART_RADIUS)
      .rect(ART_INSET, artY, artWidth, RULES_TITLE_ART_RADIUS)
      .fill(hexToNum(frame.paper));
    artwork.mask = artMask;
    artwork.visible =
      artHeight > 0 &&
      this.artTexture !== Texture.EMPTY &&
      this.artTexture.width > 0 &&
      this.artTexture.height > 0;
    if (artwork.visible) {
      const fit = landscape ? Math.min : Math.max;
      const scale = fit(artWidth / this.artTexture.width, artHeight / this.artTexture.height);
      artwork.anchor.set(0.5);
      artwork.position.set(ART_INSET + artWidth / 2, artY + artHeight / 2);
      artwork.setSize(this.artTexture.width * scale, this.artTexture.height * scale);
    }

    this.root.addChild(background, artwork, artMask, identity);

    const contentWidth = designWidth - CONTENT_PAD * 2;
    const rulesEntries = this.rulesEntries(display);
    const rulesContent = rulesEntries.join("\n\n");
    const flavorContent = this.flavorContent(display);
    const hasActions = this.actions.length > 0 && this.onSelectAction !== null;
    const sections = [
      ...(hasActions ? (["actions"] as const) : []),
      ...(rulesContent ? (["rules"] as const) : []),
      ...(flavorContent ? (["flavor"] as const) : []),
    ];
    let y = bodyTop;
    const highlightedEffect = this.highlightedEffect.trim();
    const expandedCount = sections.filter((section) => !this.isCollapsed(section)).length;
    const headersHeight = sections.length * (PREVIEW_SECTION_HEADER_HEIGHT + 4);
    const expandedGaps = expandedCount * SECTION_GAP;
    const remainingBodyHeight = Math.max(0, designHeight - footerHeight - y);
    const contentBudget =
      expandedCount > 0
        ? Math.max(1, (remainingBodyHeight - headersHeight - expandedGaps) / expandedCount)
        : 0;

    if (hasActions) {
      y = this.addSectionHeader(
        "actions",
        `Available actions · ${this.actions.length}`,
        y,
        contentWidth,
        frame,
        this.theme.gameTheme.cardRing,
      );
      if (!this.actionsCollapsed) {
        const actionPanel = new RulesPreviewActions();
        actionPanel.setContent({
          width: contentWidth / ACTIONS_CONTENT_SCALE,
          maxHeight: Math.min(ACTIONS_MAX_HEIGHT, contentBudget) / ACTIONS_CONTENT_SCALE,
          theme: this.theme,
          actions: this.actions.map((action, index) => ({ action, shortcut: index + 1 })),
          controls: [],
          statuses: [],
          hint: "",
          label: "",
          onSelectAction: this.onSelectAction!,
          embedded: true,
        });
        actionPanel.scale.set(ACTIONS_CONTENT_SCALE);
        actionPanel.position.set(CONTENT_PAD, y);
        this.root.addChild(actionPanel);
        y += actionPanel.panelHeight * ACTIONS_CONTENT_SCALE + SECTION_GAP;
      }
    }

    if (rulesContent) {
      y = this.addSectionHeader("rules", "Rules text", y, contentWidth, frame);
      if (!this.rulesCollapsed) {
        y = highlightedEffect
          ? this.addHighlightedRulesText(
              rulesEntries,
              highlightedEffect,
              y,
              contentBudget,
              contentWidth,
              frame,
            )
          : this.addTextBlock(rulesContent, y, contentBudget, contentWidth, frame, false);
      }
    }

    if (flavorContent) {
      y = this.addSectionHeader("flavor", "Flavor text", y, contentWidth, frame);
      if (!this.flavorCollapsed) {
        this.addTextBlock(flavorContent, y, contentBudget, contentWidth, frame, true);
      }
    }
    this.drawFooter(display, designWidth, designHeight, footerHeight, frame);
  }

  private isCollapsed(id: HandRulesSectionId): boolean {
    if (id === "actions") return this.actionsCollapsed;
    if (id === "rules") return this.rulesCollapsed;
    return this.flavorCollapsed;
  }

  private toggleSection(id: HandRulesSectionId): void {
    if (id === "actions") this.actionsCollapsed = !this.actionsCollapsed;
    else if (id === "rules") this.rulesCollapsed = !this.rulesCollapsed;
    else this.flavorCollapsed = !this.flavorCollapsed;
    this.rebuild();
  }

  private addHighlightedRulesText(
    entries: string[],
    highlightedEffect: string,
    y: number,
    maxHeight: number,
    width: number,
    frame: RulesPreviewFrameStyle,
  ): number {
    if (maxHeight <= 0) return y;
    const viewport = new Container();
    const content = new Container();
    const pulseTargets: Container[] = [];
    const textWidth = width - STACK_RULES_ENTRY_PAD * 2 - STACK_RULES_SCROLL_GUTTER;
    const style = new TextStyle({
      fill: frame.ink,
      fontFamily: RULES_BODY_FONT,
      fontSize: STACK_RULES_FONT_SIZE,
      fontWeight: "400",
      lineHeight: STACK_RULES_FONT_SIZE * 1.25,
    });
    const parentheticalStyle = new TextStyle({
      fill: frame.mutedInk,
      fontFamily: RULES_BODY_FONT,
      fontSize: STACK_RULES_FONT_SIZE,
      fontStyle: "italic",
      lineHeight: STACK_RULES_FONT_SIZE * 1.25,
    });
    let contentY = 0;
    let firstHighlightedTop: number | null = null;
    for (const entry of entries) {
      const row = new Container();
      const richText = new PixiRichText();
      const textHeight = richText.setContent(
        entry,
        style,
        textWidth,
        STACK_RULES_FONT_SIZE,
        RULES_LINE_GAP,
        { parentheticalStyle },
      );
      const rowHeight = textHeight + STACK_RULES_ENTRY_PAD * 2;
      richText.position.set(STACK_RULES_ENTRY_PAD, STACK_RULES_ENTRY_PAD);
      if (rulesEntryMatchesStackAbility(entry, highlightedEffect)) {
        const highlight = new Graphics();
        highlight.roundRect(0, 0, width - STACK_RULES_SCROLL_GUTTER, rowHeight, 6).fill({
          color: hexToNum(this.theme.gameTheme.activeAction.active),
          alpha: 0.28,
        });
        row.addChild(highlight);
        pulseTargets.push(row);
        firstHighlightedTop ??= contentY;
      }
      row.position.y = contentY;
      row.addChild(richText);
      content.addChild(row);
      contentY += rowHeight + STACK_RULES_ENTRY_GAP;
    }
    const contentHeight = Math.max(0, contentY - STACK_RULES_ENTRY_GAP);
    const viewportHeight = Math.min(contentHeight, maxHeight);
    const maxScroll = Math.max(0, contentHeight - viewportHeight);
    if (this.highlightedEffectScroll === null) {
      this.highlightedEffectScroll = Math.max(0, Math.min(firstHighlightedTop ?? 0, maxScroll));
    } else {
      this.highlightedEffectScroll = Math.max(0, Math.min(this.highlightedEffectScroll, maxScroll));
    }
    viewport.position.set(CONTENT_PAD, y);
    content.y = -this.highlightedEffectScroll;
    viewport.addChild(content);
    const mask = new Graphics();
    mask.rect(CONTENT_PAD, y, width, viewportHeight).fill(hexToNum(frame.paper));
    viewport.mask = mask;
    const track = new Graphics();
    const thumb = new Graphics();
    if (maxScroll > 0) {
      const trackX = width - 2;
      const thumbHeight = Math.min(
        viewportHeight,
        Math.max(18, viewportHeight * (viewportHeight / contentHeight)),
      );
      const thumbTravel = viewportHeight - thumbHeight;
      track
        .roundRect(trackX, 0, 2, viewportHeight, 1)
        .fill({ color: hexToNum(frame.ink), alpha: 0.12 });
      thumb
        .roundRect(trackX - 1, 0, 4, thumbHeight, 2)
        .fill({ color: hexToNum(frame.mutedInk), alpha: 0.85 });
      const setScroll = (offset: number): void => {
        this.highlightedEffectScroll = Math.max(0, Math.min(offset, maxScroll));
        content.y = -this.highlightedEffectScroll;
        thumb.y = thumbTravel * (this.highlightedEffectScroll / maxScroll);
      };
      setScroll(this.highlightedEffectScroll);
      viewport.eventMode = "static";
      viewport.hitArea = new Rectangle(0, 0, width, viewportHeight);
      viewport.on("wheel", (event: FederatedWheelEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const scale = Math.hypot(viewport.worldTransform.c, viewport.worldTransform.d);
        const unit =
          event.deltaMode === 1
            ? STACK_RULES_FONT_SIZE * 1.25
            : event.deltaMode === 2
              ? viewportHeight
              : scale > 0
                ? 1 / scale
                : 0;
        setScroll(this.highlightedEffectScroll! + event.deltaY * unit);
      });
      let dragPointerId: number | null = null;
      let dragStartY = 0;
      let dragStartScroll = 0;
      viewport.on("pointerdown", (event: FederatedPointerEvent) => {
        if (event.pointerType !== "touch" || dragPointerId !== null) return;
        event.stopPropagation();
        dragPointerId = event.pointerId;
        dragStartY = event.global.y;
        dragStartScroll = this.highlightedEffectScroll!;
      });
      viewport.on("globalpointermove", (event: FederatedPointerEvent) => {
        if (event.pointerId !== dragPointerId) return;
        event.stopPropagation();
        const scale = Math.hypot(viewport.worldTransform.c, viewport.worldTransform.d);
        if (scale > 0) setScroll(dragStartScroll - (event.global.y - dragStartY) / scale);
      });
      const endDrag = (event: FederatedPointerEvent): void => {
        if (event.pointerId !== dragPointerId) return;
        event.stopPropagation();
        dragPointerId = null;
      };
      viewport.on("pointerup", endDrag);
      viewport.on("pointerupoutside", endDrag);
      viewport.on("pointercancel", endDrag);
      viewport.on("pointertap", (event: FederatedPointerEvent) => event.stopPropagation());
    }
    viewport.addChild(track, thumb);
    this.root.addChild(viewport, mask);
    if (pulseTargets.length > 0 && animationsEnabled()) {
      this.highlightedEffectTween = gsap.to(pulseTargets, {
        alpha: 0.72,
        duration: STACK_RULES_PULSE_S,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
    }
    return y + viewportHeight + SECTION_GAP;
  }

  private addSectionHeader(
    id: HandRulesSectionId,
    title: string,
    y: number,
    width: number,
    frame: RulesPreviewFrameStyle,
    collapsedAccent?: string,
  ): number {
    const header = new RulesPreviewSectionHeader({
      title,
      width,
      collapsed: this.isCollapsed(id),
      frame,
      collapsedAccent,
      fontSize: SECTION_HEADER_FONT_SIZE,
      onToggle: () => this.toggleSection(id),
    });
    header.position.set(CONTENT_PAD, y);
    header.on("pointerdown", (event) => event.stopPropagation());
    this.root.addChild(header);
    return y + PREVIEW_SECTION_HEADER_HEIGHT + 4;
  }

  private addTextBlock(
    content: string,
    y: number,
    maxHeight: number,
    width: number,
    frame: RulesPreviewFrameStyle,
    italic: boolean,
  ): number {
    if (maxHeight <= 0) return y;
    const richText = new PixiRichText();
    let contentHeight = 0;
    for (let fontSize = RULES_FONT_MAX; fontSize >= RULES_FONT_MIN; fontSize -= 1) {
      const style = new TextStyle({
        fill: italic ? frame.mutedInk : frame.ink,
        fontFamily: RULES_BODY_FONT,
        fontSize,
        fontStyle: italic ? "italic" : "normal",
        fontWeight: "400",
        lineHeight: fontSize * 1.25,
      });
      contentHeight = richText.setContent(
        content,
        style,
        width,
        fontSize,
        RULES_LINE_GAP,
        italic
          ? undefined
          : {
              parentheticalStyle: new TextStyle({
                fill: frame.mutedInk,
                fontFamily: RULES_BODY_FONT,
                fontSize,
                fontStyle: "italic",
                lineHeight: fontSize * 1.25,
              }),
            },
      );
      if (contentHeight <= maxHeight || fontSize === RULES_FONT_MIN) break;
    }
    const visibleHeight = Math.min(contentHeight, maxHeight);
    richText.position.set(CONTENT_PAD, y);
    const mask = new Graphics();
    mask.rect(CONTENT_PAD, y, width, visibleHeight).fill(hexToNum(frame.paper));
    richText.mask = mask;
    this.root.addChild(richText, mask);
    if (contentHeight > visibleHeight) {
      const fadeHeight = Math.min(FADE_HEIGHT, visibleHeight);
      const fade = new Graphics();
      for (let index = 0; index < fadeHeight; index += 1) {
        fade
          .rect(CONTENT_PAD, y + visibleHeight - fadeHeight + index, width, 1)
          .fill({ color: hexToNum(frame.paper), alpha: (index + 1) / fadeHeight });
      }
      this.root.addChild(fade);
    }
    return y + visibleHeight + SECTION_GAP;
  }

  private flavorContent(display: RulesPreviewDisplay): string {
    return display.sections
      .flatMap((section) => {
        if (!section.flavorText) return [];
        if (!display.multipart) return [section.flavorText];
        return [`${section.name} — ${section.typeLine}`, section.flavorText];
      })
      .join("\n\n");
  }

  private rulesEntries(display: RulesPreviewDisplay): string[] {
    if (display.faceless) return ["Card identity and rules are hidden."];
    return display.sections.flatMap((section) => {
      const entries = rulesTextEntries(section.rulesText, null);
      if (!display.multipart) return entries;
      return [`${section.name} — ${section.typeLine}`, ...entries];
    });
  }

  private drawFooter(
    display: RulesPreviewDisplay,
    designWidth: number,
    designHeight: number,
    footerHeight: number,
    frame: RulesPreviewFrameStyle,
  ): void {
    if (footerHeight === FRAME_BOTTOM_PAD) return;
    const y = designHeight - footerHeight;
    if (display.stats) {
      drawRulesStatBadge(
        this.root,
        display.stats,
        designWidth - CONTENT_PAD,
        y + 3,
        frame,
        this.theme,
      );
      return;
    }
    const label = display.loyalty != null ? "LOYALTY" : "DEFENSE";
    const value = display.loyalty ?? display.defense;
    if (value == null) return;
    const labelText = new Text({
      text: label,
      style: new TextStyle({
        fill: frame.mutedInk,
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 11,
        fontWeight: "600",
      }),
    });
    labelText.resolution = 2;
    labelText.position.set(CONTENT_PAD, y + 15);
    const valueText = new Text({
      text: String(value),
      style: new TextStyle({
        fill: frame.ink,
        fontFamily: RULES_TITLE_FONT,
        fontSize: 24,
        fontWeight: "700",
      }),
    });
    valueText.resolution = 2;
    valueText.anchor.set(1, 0.5);
    valueText.position.set(designWidth - CONTENT_PAD, y + footerHeight / 2);
    this.root.addChild(labelText, valueText);
  }

  override destroy(options?: DestroyOptions): void {
    this.highlightedEffectTween?.kill();
    this.highlightedEffectTween = null;
    this.frameGradient?.destroy();
    this.frameGradient = null;
    super.destroy(options);
  }
}
