import {
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  Texture,
  type DestroyOptions,
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
import { PixiRichText } from "./PixiRichText";
import { RulesPreviewIdentity } from "./RulesPreviewIdentity";
import { RulesPreviewActions } from "./RulesPreviewActions";
import {
  PREVIEW_SECTION_HEADER_HEIGHT,
  RulesPreviewSectionHeader,
} from "./RulesPreviewSectionHeader";
import {
  resolveRulesPreviewDisplay,
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
const BODY_TOP_GAP = 6;
const ACTIONS_MAX_HEIGHT = 136;
const ACTIONS_CONTENT_SCALE = 1.3;
const SECTION_GAP = 6;
const SECTION_HEADER_FONT_SIZE = 15;
const FADE_HEIGHT = 18;
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
    const bodyHeight = designHeight - bodyTop - footerHeight;
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
    const rulesContent = this.rulesContent(display);
    const flavorContent = this.flavorContent(display);
    const hasActions = this.actions.length > 0 && this.onSelectAction !== null;
    const sections = [
      ...(hasActions ? (["actions"] as const) : []),
      ...(rulesContent ? (["rules"] as const) : []),
      ...(flavorContent ? (["flavor"] as const) : []),
    ];
    const expandedCount = sections.filter((section) => !this.isCollapsed(section)).length;
    const headersHeight = sections.length * (PREVIEW_SECTION_HEADER_HEIGHT + 4);
    const expandedGaps = expandedCount * SECTION_GAP;
    const contentBudget =
      expandedCount > 0
        ? Math.max(1, (bodyHeight - headersHeight - expandedGaps) / expandedCount)
        : 0;
    let y = bodyTop;

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
        y = this.addTextBlock(rulesContent, y, contentBudget, contentWidth, frame, false);
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

  private rulesContent(display: RulesPreviewDisplay): string {
    if (display.faceless) return "Card identity and rules are hidden.";
    return display.sections
      .flatMap((section) => {
        const entries = rulesTextEntries(section.rulesText, null);
        if (!display.multipart) return entries;
        return [`${section.name} — ${section.typeLine}`, ...entries];
      })
      .join("\n\n");
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
    this.frameGradient?.destroy();
    this.frameGradient = null;
    super.destroy(options);
  }
}
