import {
  Container,
  FederatedPointerEvent,
  FederatedWheelEvent,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
} from "pixi.js";
import type { CardDto } from "@/protocol/game";
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
import {
  cardFrameTintHex,
  frameTint,
  type GameThemeColors,
  type ManaLetter,
} from "@/themes/gameTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { PixiRichText } from "@/pixi/cardPreview/PixiRichText";
import { PixiCardRailPreview } from "@/pixi/cardPreview/PixiCardRailPreview";
import { setSymbolTexture } from "@/pixi/cardPreview/setSymbolCache";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useGameStore } from "@/stores/useGameStore";
import { asDeckCard } from "@/lib/decks";
import { isFacelessCard } from "@/lib/gameCard";
import { gsap } from "@/pixi/effects/gsap";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { PREVIEW_TIMING } from "@/lib/cardPreview";
import { effectiveRarity, rarityToken } from "@/lib/cardRarity";

export interface RulesCardPreviewSpec {
  card: CardDto;
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

interface AbilityTextEntry {
  text: string;
  activated: boolean;
}

interface ActionRow {
  container: Container;
  top: number;
  height: number;
  shortcut: number;
  activate: () => void;
  setFocused: (focused: boolean) => void;
}

const PANEL_WIDTH = 360;
const PANEL_HEIGHT = PANEL_WIDTH * (7 / 5);
const EDGE_PAD = 12;
const PANEL_GAP = 18;
const HEADER_HEIGHT = 52;
const ART_HEIGHT = 166;
const TYPE_HEIGHT = 32;
const FOOTER_HEIGHT = 44;
const CONTENT_PAD = 14;
const CONTENT_WIDTH = PANEL_WIDTH - CONTENT_PAD * 2;
const PANEL_RADIUS = 13;
const ART_INSET = 8;
const ART_RADIUS = 8;
const ORACLE_FONT = "Cormorant Garamond, Georgia, serif";
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
    lineHeight: 17,
  });
}

function framePalette(
  colorIdentity: string[] | undefined,
  mana: GameThemeColors["mana"],
  fallback: string,
): string[] {
  const colors = [...new Set(colorIdentity ?? [])].filter((color): color is ManaLetter =>
    ["W", "U", "B", "R", "G"].includes(color),
  );
  return colors.length > 0 ? colors.map((color) => frameTint(mana[color])) : [fallback];
}

function normalizeAbilityText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"'’.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isActivatedAbilityText(text: string): boolean {
  const colonIndex = text.indexOf(":");
  if (colonIndex <= 0) return false;
  return !/["“]/.test(text.slice(0, colonIndex));
}

function abilityTextEntries(
  rulesText: string,
  progression: CardPresentation["progression"],
): AbilityTextEntry[] {
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
    })
    .map((text) => ({ text, activated: isActivatedAbilityText(text) }));
}

function actionText(action: HandActionOption): string {
  const cost = action.cost?.trim();
  if (!cost || normalizeAbilityText(action.label).startsWith(normalizeAbilityText(cost))) {
    return action.label;
  }
  return `${cost}: ${action.label}`;
}

function actionMatchScore(text: string, action: HandActionOption): number {
  if (action.kind !== "ability") return 0;
  const normalizedText = normalizeAbilityText(text);
  const normalizedLabel = normalizeAbilityText(action.label);
  const normalizedCost = normalizeAbilityText(action.cost ?? "");
  const separatorIndex = normalizedText.indexOf(":");
  const normalizedEffect =
    separatorIndex < 0 ? normalizedText : normalizedText.slice(separatorIndex + 1).trim();
  if (
    normalizedLabel &&
    (normalizedText.includes(normalizedLabel) ||
      normalizedLabel.includes(normalizedText) ||
      (normalizedEffect.length >= 8 &&
        (normalizedLabel.includes(normalizedEffect) || normalizedEffect.includes(normalizedLabel))))
  ) {
    return 2;
  }
  if (normalizedCost && normalizedText.startsWith(`${normalizedCost}:`)) return 1;
  return 0;
}

export class RulesCardPreviewLayer {
  readonly container = new Container();

  private theme: Theme;
  private callbacks: RulesCardPreviewCallbacks;
  private background = new Graphics();
  private frame = new Graphics();
  private artBackdrop = new Graphics();
  private artSprite = new Sprite(Texture.EMPTY);
  private artMask = new Graphics();
  private chrome = new Container();
  private bodyScroller = new Container();
  private bodyContent = new Container();
  private bodyMask = new Graphics();
  private footer = new Container();
  private spec: RulesCardPreviewSpec | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private panelHeight = PANEL_HEIGHT;
  private bodyHeight = 0;
  private artHeight = ART_HEIGHT;
  private bodyTop = HEADER_HEIGHT + ART_HEIGHT + TYPE_HEIGHT;
  private footerHeight = FOOTER_HEIGHT;
  private contentHeight = 0;
  private scrollOffset = 0;
  private actionRows: ActionRow[] = [];
  private focusedActionIndex = 0;
  private artGeneration = 0;
  private setSymbolGeneration = 0;
  private interactiveReady = false;
  private interactionTimer: number | null = null;
  private dragStartY: number | null = null;
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
    this.bodyScroller.on("wheel", (event: FederatedWheelEvent) => {
      event.stopPropagation();
      this.scrollBy(event.deltaY);
    });
    this.bodyScroller.on("pointerdown", (event: FederatedPointerEvent) => {
      if (event.pointerType !== "touch") return;
      this.dragStartY = event.global.y;
      this.dragStartScroll = this.scrollOffset;
      this.dragMoved = false;
    });
    this.bodyScroller.on("pointermove", (event: FederatedPointerEvent) => {
      if (this.dragStartY == null) return;
      const delta = event.global.y - this.dragStartY;
      if (Math.abs(delta) > 5) this.dragMoved = true;
      this.setScroll(this.dragStartScroll - delta);
    });
    const endDrag = () => {
      this.dragStartY = null;
    };
    this.bodyScroller.on("pointerup", endDrag);
    this.bodyScroller.on("pointerupoutside", endDrag);

    this.container.addChild(
      this.background,
      this.frame,
      this.artBackdrop,
      this.artSprite,
      this.artMask,
      this.chrome,
      this.bodyScroller,
      this.bodyMask,
      this.footer,
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
    this.viewportWidth = width;
    this.viewportHeight = height;
    if (this.spec) this.rebuild();
  }

  setSpec(spec: RulesCardPreviewSpec | null): void {
    const previous = this.spec;
    this.spec = spec;
    if (!spec) {
      this.hide();
      return;
    }

    const artChanged =
      previous?.card.id !== spec.card.id || previous.showBackFace !== spec.showBackFace;
    const contentChanged = !previous || previous.card !== spec.card;
    const actionsChanged =
      !previous ||
      previous.actions.length !== spec.actions.length ||
      previous.actions.some((action, index) => action !== spec.actions[index]);
    if (artChanged) {
      this.scrollOffset = 0;
      this.focusedActionIndex = 0;
      void this.loadArt();
    }
    if (contentChanged || actionsChanged || previous?.sticky !== spec.sticky) this.rebuild();
    else this.layoutPanel();

    if (spec.suppressed) {
      this.container.alpha = 0;
      this.interactiveReady = false;
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
      x <= this.container.x + PANEL_WIDTH * scale &&
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

  scrollBy(delta: number): void {
    this.setScroll(this.scrollOffset + delta);
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
    const nextClassLevel =
      presentation.progression?.rail.kind === "class" &&
      presentation.progression.rail.current < presentation.progression.rail.max
        ? presentation.progression.rail.current + 1
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
    const classLevelUpActions = indexedActions.filter(({ action }) => action.isClassLevelUp);
    const railClassLevelUpAction =
      integratedClassLevelUpIndex === null
        ? undefined
        : indexedActions[integratedClassLevelUpIndex];
    const extraClassActions = railClassLevelUpAction
      ? classLevelUpActions.filter(({ index }) => index !== railClassLevelUpAction.index)
      : classLevelUpActions;
    const mainActions = indexedActions.filter(({ action }) => !action.isClassLevelUp);
    const deckCard = asDeckCard(useGameStore.getState().gameDecks[spec.card.ownerId], spec.card);
    const isLand = spec.card.types.some((type) => type.toLowerCase() === "land");
    const isArtifact = spec.card.types.some((type) => type.toLowerCase() === "artifact");
    const baseAccent = cardFrameTintHex(deckCard.colorIdentity, gameTheme.mana);
    const fallbackAccent =
      isLand && deckCard.colorIdentity.length === 0 ? frameTint(gameTheme.rarity.land) : baseAccent;
    const frameColors = framePalette(deckCard.colorIdentity, gameTheme.mana, fallbackAccent);
    const accent = frameColors[0]!;
    const rulesTint = isLand ? gameTheme.rarity.land : isArtifact ? gameTheme.mana.C : accent;
    const surface = appTheme.popover;
    const raisedSurface = appTheme.muted;
    const foreground = appTheme["popover-foreground"];
    this.artHeight = ART_HEIGHT;
    this.bodyTop = HEADER_HEIGHT + ART_HEIGHT + TYPE_HEIGHT;
    this.footerHeight =
      presentation.stats || presentation.loyalty != null || presentation.defense != null
        ? FOOTER_HEIGHT
        : 0;

    this.artBackdrop.clear();
    this.artBackdrop.roundRect(
      ART_INSET,
      HEADER_HEIGHT,
      PANEL_WIDTH - ART_INSET * 2,
      this.artHeight,
      ART_RADIUS,
    );
    this.artBackdrop.fill({ color: hexToNum(gameTheme.canvas.shadow), alpha: 0.88 });

    this.artMask.clear();
    this.artMask.roundRect(
      ART_INSET,
      HEADER_HEIGHT,
      PANEL_WIDTH - ART_INSET * 2,
      this.artHeight,
      ART_RADIUS,
    );
    this.artMask.fill(hexToNum(gameTheme.canvas.neutral));
    this.fitArt();

    const name = new Text({
      text: presentation.name,
      style: new TextStyle({
        fill: foreground,
        fontFamily: ORACLE_FONT,
        fontSize: 24,
        fontWeight: "700",
        lineHeight: 24,
        wordWrap: true,
        wordWrapWidth: 225,
      }),
    });
    name.resolution = 2;
    name.position.set(17, 8);
    this.chrome.addChild(name);

    const mana = new PixiRichText();
    mana.setContent(
      presentation.effectiveManaCost || presentation.manaCost,
      textStyle(foreground, 16, "600"),
      88,
      19,
      1,
    );
    mana.x = PANEL_WIDTH - CONTENT_PAD - mana.width;
    mana.y = 13;
    this.chrome.addChild(mana);

    const typeBandTop = HEADER_HEIGHT + this.artHeight;
    const typeBand = new Graphics();
    typeBand.rect(0, typeBandTop, PANEL_WIDTH, TYPE_HEIGHT);
    typeBand.fill({ color: hexToNum(raisedSurface), alpha: 0.98 });
    this.chrome.addChild(typeBand);

    let typeLineX = CONTENT_PAD;
    if (spec.card.isDoubleFaced) {
      const flip = this.createControl("↻ F", () => this.callbacks.onFlip());
      flip.position.set(CONTENT_PAD, typeBandTop + 5);
      this.chrome.addChild(flip);
      typeLineX = 47;
    }

    const typeLine = new Text({
      text: presentation.typeLine,
      style: new TextStyle({
        fill: foreground,
        fontFamily: ORACLE_FONT,
        fontSize: 14,
        fontWeight: "700",
        lineHeight: 16,
        wordWrap: true,
        wordWrapWidth: PANEL_WIDTH - typeLineX - 52,
      }),
    });
    typeLine.resolution = 2;
    typeLine.position.set(typeLineX, typeBandTop + 7);
    this.chrome.addChild(typeLine);

    const setSymbol = new Sprite(Texture.EMPTY);
    const setFallback = new Text({
      text: spec.card.identity.setCode.toUpperCase(),
      style: textStyle(appTheme["muted-foreground"], 9, "700"),
    });
    setFallback.resolution = 2;
    setFallback.anchor.set(0.5);
    setFallback.position.set(PANEL_WIDTH - CONTENT_PAD - 11, typeBandTop + 16);
    setSymbol.position.set(PANEL_WIDTH - CONTENT_PAD - 22, typeBandTop + 5);
    this.chrome.addChild(setFallback, setSymbol);
    void this.loadSetSymbol(setSymbol, setFallback, spec.card, ++this.setSymbolGeneration);

    this.bodyScroller.position.set(CONTENT_PAD, this.bodyTop);

    let y = 10;
    if (presentation.keywords.length > 0) {
      y = this.addKeywordBadges(presentation.keywords, y);
      y += 7;
    }

    const abilityEntries = abilityTextEntries(presentation.rulesText, presentation.progression);
    const staticAbilities = abilityEntries.filter((entry) => !entry.activated);
    const activatedAbilities = abilityEntries.filter((entry) => entry.activated);
    const unmatchedActions = [...mainActions];
    y = this.addSectionLabel("ABILITIES", y, appTheme.ring);
    if (abilityEntries.length === 0 && unmatchedActions.length === 0 && !presentation.progression) {
      y = this.addStaticAbilityRow("No abilities.", y);
    } else {
      for (const entry of staticAbilities) {
        y = this.addStaticAbilityRow(entry.text, y);
      }
      for (const entry of activatedAbilities) {
        let matchIndex = -1;
        let matchScore = 0;
        for (const [index, candidate] of unmatchedActions.entries()) {
          const score = actionMatchScore(entry.text, candidate.action);
          if (score > matchScore) {
            matchIndex = index;
            matchScore = score;
          }
        }
        if (matchIndex < 0) {
          y = this.addDisabledAbilityRow(entry.text, y);
          continue;
        }
        const [matchedAction] = unmatchedActions.splice(matchIndex, 1);
        const relatedActions =
          matchedAction?.action.abilityIndex == null
            ? []
            : unmatchedActions.filter(
                ({ action }) => action.abilityIndex === matchedAction.action.abilityIndex,
              );
        for (const related of relatedActions) {
          unmatchedActions.splice(unmatchedActions.indexOf(related), 1);
        }
        y = this.addActionRows([matchedAction!, ...relatedActions], y, appTheme.ring);
      }
      if (unmatchedActions.length > 0) {
        y = this.addActionRows(unmatchedActions, y, appTheme.ring);
      }
    }
    y += 8;

    if (presentation.progression) {
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
        state: presentation.progression.rail,
        effects: presentation.progression.effects,
        interactions: railInteractions,
        width: CONTENT_WIDTH,
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

    if (extraClassActions.length > 0) {
      y = this.addActionRows(extraClassActions, y, appTheme.ring);
      y += 8;
    }

    if (presentation.statuses.length > 0) {
      y = this.addSectionLabel("STATE", y, accent);
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
      presentation.progression?.rail.kind === "saga"
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
    this.bodyHeight = PANEL_HEIGHT - this.bodyTop - this.footerHeight;
    this.panelHeight = PANEL_HEIGHT;

    this.background.clear();
    this.background.roundRect(0, 0, PANEL_WIDTH, this.panelHeight, PANEL_RADIUS);
    this.background.fill({ color: hexToNum(surface), alpha: 0.98 });

    this.frame.clear();
    this.frame.roundRect(0, 0, PANEL_WIDTH, this.panelHeight, PANEL_RADIUS);
    this.frame.fill({ color: hexToNum(rulesTint), alpha: 0.07 });

    this.bodyScroller.hitArea = new Rectangle(0, 0, CONTENT_WIDTH, this.bodyHeight);
    this.bodyMask.clear();
    this.bodyMask.rect(CONTENT_PAD, this.bodyTop, CONTENT_WIDTH, this.bodyHeight);
    this.bodyMask.fill(hexToNum(appTheme.background));

    this.setScroll(this.scrollOffset);
    this.drawFooter(presentation.stats, presentation.loyalty, presentation.defense);
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
    const height = 18;
    background.roundRect(0, 0, width, height, 9);
    background.fill({ color: hexToNum(this.theme.appTheme.muted), alpha: 0.96 });
    text.position.set(6, 2);
    control.addChild(background, text);
    control.eventMode = "static";
    control.cursor = "pointer";
    control.hitArea = new Rectangle(-4, -4, width + 8, height + 8);
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
          fill: this.theme.gameTheme.textOnTinted,
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.4,
          lineHeight: 13,
        }),
        CONTENT_WIDTH - 16,
        14,
        1,
      );
      const width = Math.min(CONTENT_WIDTH, rich.width + 16);
      const badgeHeight = Math.max(21, height + 6);
      if (x > 0 && x + width > CONTENT_WIDTH) {
        x = 0;
        y += rowHeight + 5;
        rowHeight = 0;
      }
      const badge = new Container();
      const background = new Graphics();
      background.roundRect(0, 0, width, badgeHeight, 4);
      background.fill({
        color: hexToNum(this.theme.gameTheme.canvas.shadow),
        alpha: 0.75,
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
      const width = Math.min(CONTENT_WIDTH, label.width + 14);
      const height = 21;
      if (x > 0 && x + width > CONTENT_WIDTH) {
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
    const row = new Container();
    const rich = new PixiRichText();
    const reminder = /^\([\s\S]*\)$/.test(text.trim());
    const textHeight = rich.setContent(
      text,
      oracleTextStyle(
        reminder
          ? this.theme.appTheme["muted-foreground"]
          : this.theme.appTheme["popover-foreground"],
        reminder,
      ),
      CONTENT_WIDTH - 8,
      17,
      5,
    );
    const height = Math.max(34, textHeight + 14);
    rich.position.set(4, 6);
    row.position.set(0, y);
    row.addChild(rich);
    this.bodyContent.addChild(row);
    return y + height + 7;
  }

  private addDisabledAbilityRow(text: string, y: number): number {
    const row = new Container();
    const background = new Graphics();
    const keyBackground = new Graphics();
    keyBackground.roundRect(9, 9, 23, 23, 6);
    keyBackground.fill({ color: hexToNum(this.theme.appTheme.muted), alpha: 0.62 });
    const key = new Text({
      text: "—",
      style: textStyle(this.theme.appTheme["muted-foreground"], 12, "700"),
    });
    key.resolution = 2;
    key.anchor.set(0.5);
    key.position.set(20.5, 20.5);
    const label = new PixiRichText();
    const labelHeight = label.setContent(
      text,
      oracleTextStyle(this.theme.appTheme["muted-foreground"]),
      CONTENT_WIDTH - 55,
      17,
      4,
    );
    label.position.set(43, 9);
    const height = Math.max(41, labelHeight + 18);
    background.roundRect(0, 0, CONTENT_WIDTH, height, 9);
    background.fill({ color: hexToNum(this.theme.appTheme.muted), alpha: 0.2 });
    row.position.set(0, y);
    row.alpha = 0.7;
    row.addChild(background, keyBackground, key, label);
    this.bodyContent.addChild(row);
    return y + height + 6;
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
        CONTENT_WIDTH - 55,
        17,
        4,
      );
      label.position.set(43, 9);
      const height = Math.max(41, labelHeight + 18);
      row.position.set(0, y);
      row.hitArea = new Rectangle(0, 0, CONTENT_WIDTH, height);
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
        background.roundRect(0, 0, CONTENT_WIDTH, height, 9);
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
    this.actionRows.forEach((row, index) => {
      row.setFocused(index === this.focusedActionIndex);
    });
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
    background.roundRect(0, 0, PANEL_WIDTH, this.footerHeight, PANEL_RADIUS);
    background.fill({
      color: hexToNum(this.theme.appTheme.card),
      alpha: 1,
    });
    background.rect(0, 0, PANEL_WIDTH, PANEL_RADIUS);
    background.fill({ color: hexToNum(this.theme.appTheme.card), alpha: 1 });
    this.footer.addChild(background);

    if (stats?.damage) {
      const damage = new Text({
        text: `DAMAGE ${stats.damage}`,
        style: textStyle(this.theme.gameTheme.pt.lethal, 11, "700"),
      });
      damage.resolution = 2;
      damage.position.set(CONTENT_PAD, 20);
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
      badge.roundRect(PANEL_WIDTH - CONTENT_PAD - width, 7, width, 30, 8);
      badge.fill({ color: hexToNum(color), alpha: 0.94 });
      value.position.set(PANEL_WIDTH - CONTENT_PAD - width / 2, 22);
      value.anchor.set(0.5);
      this.footer.addChild(badge, value);

      if (stats.basePower != null && stats.baseToughness != null && stats.state !== "neutral") {
        const base = new Text({
          text: `${stats.basePower}/${stats.baseToughness}`,
          style: textStyle(this.theme.appTheme["muted-foreground"], 10, "500"),
        });
        base.resolution = 2;
        base.anchor.set(1, 0.5);
        base.position.set(PANEL_WIDTH - CONTENT_PAD - width - 7, 22);
        this.footer.addChild(base);
      }
    }
  }

  private drawShieldValue(value: number, label: string, color: string): void {
    const right = PANEL_WIDTH - CONTENT_PAD;
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
      (this.viewportWidth - EDGE_PAD * 2) / PANEL_WIDTH,
      (this.viewportHeight - EDGE_PAD * 2) / PANEL_HEIGHT,
    );
    const width = PANEL_WIDTH * scale;
    const height = this.panelHeight * scale;
    this.container.scale.set(scale);
    this.container.hitArea = new Rectangle(0, 0, PANEL_WIDTH, this.panelHeight);

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
      ? Math.max(0.25, Math.min(0.85, spec.anchor.width / PANEL_WIDTH))
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
  }

  private ensureFocusedActionVisible(): void {
    const row = this.actionRows[this.focusedActionIndex];
    if (!row) return;
    if (row.top < this.scrollOffset) this.setScroll(row.top - 8);
    else if (row.top + row.height > this.scrollOffset + this.bodyHeight) {
      this.setScroll(row.top + row.height - this.bodyHeight + 8);
    }
  }

  private async loadSetSymbol(
    symbol: Sprite,
    fallback: Text,
    card: CardDto,
    generation: number,
  ): Promise<void> {
    fallback.visible = false;
    try {
      const store = useScryfallStore.getState();
      const entry = await store.getCard({
        name: card.identity.name,
        setCode: card.identity.setCode || undefined,
        collectorNumber: card.identity.cardNumber || undefined,
      });
      if (generation !== this.setSymbolGeneration || symbol.destroyed || fallback.destroyed) return;
      const rarity = effectiveRarity(entry.info);
      const token = rarityToken(rarity);
      if (!token) return;
      const color = this.theme.gameTheme.rarity[token];
      fallback.text = rarity[0]!.toUpperCase();
      fallback.style.fill = color;
      fallback.visible = true;
      const iconUrl = useScryfallStore
        .getState()
        .sets.find((set) => set.code === entry.info.set.toLowerCase())?.icon_svg_uri;
      if (!iconUrl) return;
      const texture = await setSymbolTexture(iconUrl);
      if (generation !== this.setSymbolGeneration || symbol.destroyed || fallback.destroyed) return;
      symbol.texture = texture;
      symbol.tint = hexToNum(color);
      symbol.setSize(22, 22);
      symbol.visible = true;
      fallback.visible = false;
    } catch {
      if (generation === this.setSymbolGeneration && !symbol.destroyed) {
        symbol.visible = false;
      }
    }
  }

  private async loadArt(): Promise<void> {
    const spec = this.spec;
    if (!spec) return;
    const generation = ++this.artGeneration;
    const deckCard = asDeckCard(useGameStore.getState().gameDecks[spec.card.ownerId], spec.card);
    try {
      const texture = isFacelessCard(spec.card)
        ? Texture.EMPTY
        : await useScryfallStore
            .getState()
            .getCardTexture(deckCard, "art", spec.showBackFace ? 1 : 0);
      if (!this.spec || generation !== this.artGeneration || this.artSprite.destroyed) return;
      this.artSprite.texture = texture;
      this.fitArt();
    } catch {
      if (generation === this.artGeneration && !this.artSprite.destroyed) {
        this.artSprite.texture = Texture.EMPTY;
      }
    }
  }

  private fitArt(): void {
    const texture = this.artSprite.texture;
    if (!texture || texture === Texture.EMPTY || texture.width <= 0 || texture.height <= 0) return;
    const width = PANEL_WIDTH - ART_INSET * 2;
    const height = this.artHeight;
    const imageAspect = texture.width / texture.height;
    const frameAspect = width / height;
    this.artSprite.anchor.set(0.5);
    this.artSprite.position.set(ART_INSET + width / 2, HEADER_HEIGHT + height / 2);
    if (imageAspect > frameAspect) this.artSprite.setSize(height * imageAspect, height);
    else this.artSprite.setSize(width, width / imageAspect);
  }

  private hide(): void {
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    if (this.interactionTimer != null) {
      window.clearTimeout(this.interactionTimer);
      this.interactionTimer = null;
    }
    this.interactiveReady = false;
    this.container.visible = false;
    this.container.alpha = 0;
  }

  destroy(): void {
    this.hide();
    this.artGeneration += 1;
    this.setSymbolGeneration += 1;
    this.container.destroy({ children: true });
  }
}
