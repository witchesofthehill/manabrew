import {
  Container,
  type FederatedWheelEvent,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Text,
} from "pixi.js";
import { OPPONENT_SEATS } from "@/components/game/game.types";
import { hexToNum } from "@/pixi/colorUtils";
import { CardSprite } from "@/pixi/CardSprite";
import { loadManaSymbolTexture } from "@/pixi/manaSymbolCache";
import { readableTextColor } from "@/themes/gameTheme";
import {
  CARD_H,
  CARD_RADIUS,
  CARD_W,
  GAME_CARD_SIZES,
  PROMPT_CARD_GAP,
  PROMPT_CARD_MODAL_MAX_WIDTH,
  PROMPT_CARD_ROW_GAP,
  PROMPT_MODAL_VIEWPORT_MARGIN,
} from "@/components/game/game.constants";
import type {
  CardDto,
  ChooseCombatDamageAssignmentInput,
  PromptPresentation,
  ReorderItem,
  ScryDestination,
  SelectionOption,
  TargetRef,
} from "@/protocol";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
import { createRollToken, setRollTokenValue } from "./dice/DiceGeometry";
import {
  ROLL_IMPACT_MS,
  ROLL_SETTLE_MS,
  rollingDieValue,
  rollSeed,
  rollTrajectory,
} from "./dice/DiceAnimation";
import {
  CARD_ASPECT_RATIO,
  CARD_TILE_EDGE_INSET,
  MODAL_BODY_BOTTOM_PADDING,
  MODAL_MIN_HEIGHT,
  MODAL_SCROLL_LINE_HEIGHT,
  MODAL_SCROLL_MAX_STEP,
  MODAL_SCROLL_SCALE,
  PANEL_PADDING,
  REORDER_CARD_INSET,
  REORDER_LAYOUT_SETTLE_SECONDS,
  REORDER_MODAL_VERTICAL_RESERVE,
  REORDER_ORDER_ZONE_ID,
  REORDER_PREVIEW_SECONDS,
  ROW_GAP,
  type RollDisplayEntry,
  SCRY_BODY_FIXED_HEIGHT,
  SCRY_LAYOUT_SETTLE_SECONDS,
  SOURCE_CARD_GAP,
  SOURCE_LABEL_HEIGHT,
  parseCombatNumber,
  promptRichText,
  promptText,
  PromptLayerBase,
} from "./PromptLayerBase";

const CHOICE_MODAL_WIDTH = 560;

export abstract class PromptModalLayer extends PromptLayerBase {
  protected renderModal(): void {
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
      case "diceRolled":
        this.renderDice(input.presentation, input.sides, input.rolls);
        break;
    }
    this.finalizeModalScroll();
    this.animateReorderLayout();
    this.animateScryLayout();
  }

  protected createModalShell(
    width: number,
    height: number,
    presentation: PromptPresentation,
    minimizable = true,
    footerHeight = 0,
    footerContentHeight = 36,
  ): {
    panel: Container;
    body: Container;
    bodyTop: number;
    footer: Container;
  } {
    const sourceCard = this.promptSourceCard();
    const { width: preferredSourceWidth } = this.promptSourceCardDimensions();
    const preferredSourceSize = sourceCard
      ? this.promptCardDisplayDimensions(sourceCard, preferredSourceWidth)
      : { width: 0, height: 0 };
    const clusterWidth = width + SOURCE_CARD_GAP + preferredSourceSize.width;
    const externalSource =
      !!sourceCard &&
      clusterWidth <= this.viewportWidth - 24 &&
      SOURCE_LABEL_HEIGHT + preferredSourceSize.height <= this.viewportHeight - 24;
    const x = externalSource
      ? (this.viewportWidth - clusterWidth) / 2
      : (this.viewportWidth - width) / 2;
    const y = (this.viewportHeight - height) / 2;
    const sourceLeft = width + SOURCE_CARD_GAP;
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
    let sourceWidth = 0;
    let sourceHeight = 0;
    let sourceX = 0;
    let sourceY = 0;
    let sourceLabel: Text | null = null;
    let placeSourceSprite: (() => void) | null = null;
    if (sourceSprite && sourceCard) {
      this.configurePromptCardSprite(sourceSprite, sourceCard);
      sourceSprite.setHandRulesHighlight(this.spec?.currentPrompt?.sourceAbilityText ?? "");
      const availableSourceWidth = width - PANEL_PADDING * 2;
      const preferredLandscape =
        this.promptCardDisplayDimensions(sourceCard, preferredSourceWidth).width >
        preferredSourceWidth;
      const portraitSourceWidth = Math.min(
        preferredSourceWidth,
        preferredLandscape ? availableSourceWidth / CARD_ASPECT_RATIO : availableSourceWidth,
      );
      const sourceSize = this.promptCardDisplayDimensions(sourceCard, portraitSourceWidth);
      sourceWidth = sourceSize.width;
      sourceHeight = sourceSize.height;
      placeSourceSprite = () => {
        const rotated =
          sourceSprite.horizontalFrame && !this.promptCardState(sourceCard).horizontalFlipped;
        sourceSprite.rotation = rotated ? -Math.PI / 2 : 0;
        const horizontal = sourceSprite.horizontalFrame && !rotated;
        const cardWidth = horizontal ? CARD_H : CARD_W;
        const cardHeight = horizontal ? CARD_W : CARD_H;
        const scale = Math.min(sourceWidth / cardWidth, sourceHeight / cardHeight);
        sourceSprite.scale.set(scale);
        sourceSprite.syncHandControlsScale();
        sourceSprite.position.set(
          sourceX + (cardWidth * scale) / 2,
          sourceY + (cardHeight * scale) / 2,
        );
      };
      sourceSprite.onReorient = placeSourceSprite;
      sourceSprite.cursor = "pointer";
      sourceSprite.accessible = true;
      sourceSprite.accessibleTitle = `${sourceCard.identity.name}, source card`;
      sourceSprite.accessibleHint = "Focus or hover, then change view or flip face";
      sourceSprite.tabIndex = 0;
      this.bindPromptCardActivation(sourceSprite, sourceCard, sourceSprite, false);
      sourceLabel = promptText("SOURCE", 10, this.theme.appTheme["muted-foreground"], {
        weight: "700",
      });
      panel.addChild(sourceSprite, sourceLabel);
    }
    const stackSource =
      !!sourceSprite &&
      !externalSource &&
      width - PANEL_PADDING * 2 - sourceWidth < GAME_CARD_SIZES.hand.width;
    const titleX =
      sourceSprite && !externalSource && !stackSource
        ? PANEL_PADDING + sourceWidth + 16
        : PANEL_PADDING;
    const title = promptRichText(
      presentation.title,
      this.viewportWidth < 760 ? 18 : 22,
      this.theme.appTheme.foreground,
      width - titleX - 50,
      { weight: "700" },
    );
    title.position.set(titleX, 16);
    panel.addChild(title);
    let bodyTop = 16 + title.height + 8;
    if (sourceSprite && sourceLabel && placeSourceSprite) {
      if (externalSource) {
        sourceX = sourceLeft;
        sourceY = SOURCE_LABEL_HEIGHT;
        sourceLabel.position.set(sourceLeft, 0);
        panel.hitArea = new Rectangle(
          0,
          0,
          sourceLeft + sourceWidth,
          Math.max(height, SOURCE_LABEL_HEIGHT + sourceHeight),
        );
      } else if (stackSource) {
        sourceX = (width - sourceWidth) / 2;
        sourceY = bodyTop + SOURCE_LABEL_HEIGHT + 4;
        sourceLabel.position.set(sourceX, bodyTop + 4);
        bodyTop = sourceY + sourceHeight + 8;
      } else {
        sourceX = PANEL_PADDING;
        sourceY = SOURCE_LABEL_HEIGHT + 8;
        sourceLabel.position.set(sourceX, 8);
        bodyTop = Math.max(bodyTop, sourceY + sourceHeight + 8);
      }
      sourceSprite.onReorient?.();
    }
    if (presentation.description) {
      const description = promptRichText(
        presentation.description,
        14,
        this.theme.appTheme.foreground,
        width - PANEL_PADDING * 2,
      );
      description.alpha = 0.9;
      description.position.set(PANEL_PADDING, bodyTop);
      panel.addChild(description);
      bodyTop += description.height + 6;
    }
    if (presentation.text) {
      const rules = promptRichText(
        presentation.text,
        12,
        this.theme.appTheme["muted-foreground"],
        width - PANEL_PADDING * 2,
      );
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
      minimize.position.set(
        Math.min(width - 18, this.viewportWidth - x - minimize.buttonWidth),
        Math.max(-14, -y),
      );
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
      hitWidth: externalSource ? sourceLeft + sourceWidth : width,
      externalSourceHeight: externalSource ? SOURCE_LABEL_HEIGHT + sourceHeight : 0,
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

  protected resizeModalShell(
    state: NonNullable<PromptModalLayer["modalBody"]>,
    height: number,
  ): void {
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

  protected scrollModal(event: FederatedWheelEvent): void {
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

  protected finalizeModalScroll(): void {
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
      this.viewportHeight - PROMPT_MODAL_VIEWPORT_MARGIN,
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

  protected syncModalScrollPosition(): void {
    const state = this.modalBody;
    if (!state) return;
    state.body.y = state.bodyTop - this.modalScrollOffset;
    if (this.modalScrollMax <= 0) return;
    const thumbHeight = state.scrollThumb.height;
    const travel = Math.max(0, state.viewportHeight - thumbHeight);
    state.scrollThumb.y = state.bodyTop + travel * (this.modalScrollOffset / this.modalScrollMax);
  }

  protected renderBoolean(
    presentation: PromptPresentation,
    denyLabel: string,
    confirmLabel: string,
  ): void {
    const width = this.modalPromptWidth(520);
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

  protected renderSelection(
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
    const width = this.modalPromptWidth(CHOICE_MODAL_WIDTH);
    const height = Math.min(
      Math.max(260, 132 + visibleRowCount * 66 + (showFilter ? 48 : 0) + (autoConfirm ? 0 : 52)),
      this.viewportHeight - 24,
    );
    const { body, footer } = this.createModalShell(
      width,
      height,
      presentation,
      true,
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
            selected ? this.theme.gameTheme.cardSelection : this.theme.appTheme.background,
          ),
          alpha: selected ? 0.12 : 0.55,
        })
        .stroke({
          color: hexToNum(
            selected ? this.theme.gameTheme.cardSelection : this.theme.appTheme.border,
          ),
          width: selected ? 2 : 1,
          alpha: selected ? 0.9 : 0.8,
        });
      row.addChild(rowBackground);

      const indicator = new Graphics()
        .circle(22, rowHeight / 2, 10)
        .fill({
          color: hexToNum(
            selected ? this.theme.gameTheme.cardSelection : this.theme.appTheme.background,
          ),
          alpha: selected ? 1 : 0.55,
        })
        .stroke({
          color: hexToNum(
            selected ? this.theme.gameTheme.cardSelection : this.theme.appTheme["muted-foreground"],
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
      const label = promptRichText(
        option.label,
        13,
        this.theme.appTheme.foreground,
        availableWidth - 58 - quantityWidth,
        { weight: "600", maxLines: 1 },
      );
      label.position.set(42, showWeights ? 10 : 19);
      row.addChild(label);
      if (showWeights) {
        const weight = promptText(
          `${option.weight} point${option.weight === 1 ? "" : "s"}`,
          10,
          selected ? this.theme.gameTheme.cardSelection : this.theme.appTheme["muted-foreground"],
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

  protected selectionTotal(options: SelectionOption[]): number {
    let total = 0;
    for (const [index, count] of this.counts) {
      if (typeof index === "number") total += count * (options[index]?.weight ?? 0);
    }
    return total;
  }

  protected renderCards(
    presentation: PromptPresentation,
    cards: CardDto[],
    min: number,
    max: number,
    reveal: boolean,
  ): void {
    const { width: preferredCardWidth } = this.promptCardDimensions();
    const maxCardWidthRatio = Math.max(
      1,
      ...cards.map((card) => this.promptCardDisplayDimensions(card, CARD_W).width / CARD_W),
    );
    const preferredRowWidth =
      cards.length * preferredCardWidth * maxCardWidthRatio +
      Math.max(0, cards.length - 1) * PROMPT_CARD_GAP +
      PANEL_PADDING * 2 +
      CARD_TILE_EDGE_INSET * 2;
    const width = this.modalPromptWidth(
      Math.min(PROMPT_CARD_MODAL_MAX_WIDTH, Math.max(CHOICE_MODAL_WIDTH, preferredRowWidth)),
    );
    const cardAreaWidth = width - PANEL_PADDING * 2 - CARD_TILE_EDGE_INSET * 2;
    const portraitCardWidth = Math.min(preferredCardWidth, cardAreaWidth / maxCardWidthRatio);
    const cardSizes = cards.map((card) =>
      this.promptCardDisplayDimensions(card, portraitCardWidth),
    );
    const cardWidth = Math.max(0, ...cardSizes.map((size) => size.width));
    const cardHeight = Math.max(0, ...cardSizes.map((size) => size.height));
    const columns = Math.max(
      1,
      Math.min(
        cards.length,
        Math.floor((cardAreaWidth + PROMPT_CARD_GAP) / (cardWidth + PROMPT_CARD_GAP)),
      ),
    );
    const rows = Math.ceil(cards.length / columns);
    const height = Math.min(
      this.viewportHeight - 24,
      244 + rows * (cardHeight + PROMPT_CARD_ROW_GAP),
    );
    const { body, footer } = this.createModalShell(
      width,
      height,
      reveal
        ? {
            ...presentation,
            description:
              presentation.description ??
              `${cards.length} card${cards.length === 1 ? "" : "s"} shown`,
          }
        : presentation,
      true,
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
      const cardSize = cardSizes[index]!;
      const tile = this.createCardTile(
        card,
        selected,
        disabled,
        cardSize.width,
        cardSize.height,
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
        CARD_TILE_EDGE_INSET +
          column * (cardWidth + PROMPT_CARD_GAP) +
          (cardWidth - cardSize.width) / 2,
        startY + row * (cardHeight + PROMPT_CARD_ROW_GAP) + (cardHeight - cardSize.height) / 2,
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

  protected createCardTile(
    card: CardDto,
    selected: boolean,
    disabled: boolean,
    width: number,
    height: number,
    onPress?: () => void,
    actionable = !!onPress,
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
    this.bindPromptCardActivation(tile, card, sprite, actionable && !disabled);
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
        .stroke({ color: hexToNum(this.theme.gameTheme.cardSelection), width: 4 });
      ring.eventMode = "none";
      const badge = new Graphics()
        .circle(width - 14, 14, 12)
        .fill({ color: hexToNum(this.theme.gameTheme.cardSelection) })
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

  protected renderColors(
    presentation: PromptPresentation,
    validColors: string[],
    amount: number,
    repeatAllowed: boolean,
  ): void {
    const width = this.modalPromptWidth(620);
    const height = Math.min(
      this.viewportHeight - 24,
      amount <= 1 ? 230 : 190 + validColors.length * 64,
    );
    const { body, footer } = this.createModalShell(
      width,
      height,
      presentation,
      true,
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
            foreground: readableTextColor(
              colors[color] ?? this.theme.appTheme.muted,
              this.theme.gameTheme.canvas.background,
              this.theme.gameTheme.textOnTinted,
            ),
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

  protected renderNumber(presentation: PromptPresentation, min: number, max: number): void {
    const range = max - min + 1;
    const width = this.modalPromptWidth(520);
    const height = Math.min(range <= 10 ? 250 : 275, this.viewportHeight - 24);
    const { body, footer } = this.createModalShell(
      width,
      height,
      presentation,
      true,
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

  protected renderReorder(presentation: PromptPresentation, items: ReorderItem[]): void {
    const width = this.modalPromptWidth(PROMPT_CARD_MODAL_MAX_WIDTH);
    const contentWidth = width - PANEL_PADDING * 2;
    const zoneWidth = contentWidth - CARD_TILE_EDGE_INSET * 2;
    const { width: preferredCardWidth } = this.promptCardDimensions();
    const maxCardWidthRatio = Math.max(
      ...items.map((item) => this.promptCardDisplayDimensions(item.card, CARD_W).width / CARD_W),
    );
    const denseCardWidth =
      items.length <= 1
        ? preferredCardWidth
        : (zoneWidth - REORDER_CARD_INSET * 2 - 12 * (items.length - 1)) /
          items.length /
          maxCardWidthRatio;
    const portraitCardWidth = Math.min(
      preferredCardWidth,
      (zoneWidth - REORDER_CARD_INSET * 2) / maxCardWidthRatio,
      Math.max(112, denseCardWidth),
    );
    const cardSizes = new Map(
      items.map((item) => [
        item.id,
        this.promptCardDisplayDimensions(item.card, portraitCardWidth),
      ]),
    );
    const cardWidth = Math.max(...[...cardSizes.values()].map((size) => size.width));
    const cardHeight = Math.max(...[...cardSizes.values()].map((size) => size.height));
    const sourceCard = this.promptSourceCard();
    const sourceIsInternal =
      !!sourceCard &&
      width +
        SOURCE_CARD_GAP +
        this.promptCardDisplayDimensions(sourceCard, this.promptSourceCardDimensions().width)
          .width >
        this.viewportWidth - 24;
    const height = Math.min(
      this.viewportHeight - 24,
      cardHeight +
        REORDER_MODAL_VERTICAL_RESERVE +
        (sourceIsInternal ? preferredCardWidth * CARD_ASPECT_RATIO : 0),
    );
    const { body, footer } = this.createModalShell(width, height, presentation, true, 60);
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
      const cardSize = cardSizes.get(id);
      if (!item || !cardSize) return;
      const tile = this.createCardTile(
        item.card,
        false,
        false,
        cardSize.width,
        cardSize.height,
        undefined,
        true,
      );
      tile.accessibleTitle = `${item.card.identity.name}, position ${index + 1}`;
      tile.accessibleHint = "Drag to reorder or use the earlier and later controls";
      tile.zIndex = index + 1;
      const slotX = this.reorderCardX(orderZone, cardWidth, index, this.order.length);
      const slotY = orderZone.y + REORDER_CARD_INSET;
      const x = slotX + (cardWidth - cardSize.width) / 2;
      const y = slotY + (cardHeight - cardSize.height) / 2;
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
      const controlX = slotX + (cardWidth - controlRowWidth) / 2;
      const controlY = slotY + cardHeight + 8;
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
        slotOffsetX: x - slotX,
        slotOffsetY: y - slotY,
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

  protected reorderCardX(zone: Rectangle, cardWidth: number, index: number, count: number): number {
    if (count <= 1) return zone.x + REORDER_CARD_INSET;
    const available = Math.max(0, zone.width - cardWidth - REORDER_CARD_INSET * 2);
    const spacing = Math.min(cardWidth + 12, available / (count - 1));
    return zone.x + REORDER_CARD_INSET + index * spacing;
  }

  protected reorderInsertIndex(
    zone: Rectangle,
    cardWidth: number,
    count: number,
    x: number,
  ): number {
    if (count === 0) return 0;
    const available = Math.max(0, zone.width - cardWidth - REORDER_CARD_INSET * 2);
    const spacing = Math.min(cardWidth + 12, available / count);
    if (spacing === 0) return count;
    const firstCenter = zone.x + REORDER_CARD_INSET + cardWidth / 2;
    return Math.max(0, Math.min(count, Math.round((x - firstCenter) / spacing)));
  }

  protected previewReorderGap(cardId: string, cardWidth: number, x: number, y: number): void {
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

      const slotX = this.reorderCardX(orderZone.rect, cardWidth, previewIndex, previewOrder.length);
      const slotY = orderZone.rect.y + REORDER_CARD_INSET;
      const targetX = slotX + visual.slotOffsetX;
      const targetY = slotY + visual.slotOffsetY;
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

  protected dropReorderCard(cardId: string, cardWidth: number, x: number, y: number): void {
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

  protected reorderDropPosition(
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
    const visual = this.reorderCardVisuals.get(cardId);
    return {
      x:
        this.reorderCardX(target.rect, cardWidth, index, nextOrder.length + 1) +
        (visual?.slotOffsetX ?? 0),
      y: target.rect.y + REORDER_CARD_INSET + (visual?.slotOffsetY ?? 0),
    };
  }

  protected animateReorderLayout(): void {
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

  protected captureReorderCardPositions(): void {
    this.reorderPreviousPositions.clear();
    for (const [cardId, visual] of this.reorderCardVisuals) {
      const position = visual.tile.toGlobal({ x: 0, y: 0 });
      this.reorderPreviousPositions.set(cardId, { x: position.x, y: position.y });
    }
  }

  protected clearReorderCardVisuals(): void {
    for (const { tile, controls } of this.reorderCardVisuals.values()) {
      gsap.killTweensOf(tile.position);
      gsap.killTweensOf(tile.scale);
      gsap.killTweensOf(controls.position);
      gsap.killTweensOf(controls);
    }
    this.reorderCardVisuals.clear();
    this.reorderPreview = null;
  }

  protected renderScry(
    presentation: PromptPresentation,
    cards: CardDto[],
    zones: ScryDestination[],
  ): void {
    const width = this.modalPromptWidth(PROMPT_CARD_MODAL_MAX_WIDTH);
    const poolWidth = width - PANEL_PADDING * 2;
    const zoneGap = 12;
    const zoneWidth = (poolWidth - zoneGap * (zones.length - 1)) / Math.max(1, zones.length);
    const { width: preferredCardWidth } = this.promptCardDimensions();
    const baseCardSizes = cards.map((card) => this.promptCardDisplayDimensions(card, CARD_W));
    const maxCardWidthRatio = Math.max(...baseCardSizes.map((size) => size.width / CARD_W));
    const maxCardHeightRatio = Math.max(...baseCardSizes.map((size) => size.height / CARD_W));
    const stackDepth = Math.min(64, Math.max(0, cards.length - 1) * 16);
    const height = this.viewportHeight - 24;
    const footerHeight = 64;
    const { body, bodyTop, footer } = this.createModalShell(
      width,
      height,
      presentation,
      true,
      footerHeight,
    );
    const availableCardRowsHeight =
      height -
      bodyTop -
      footerHeight -
      MODAL_BODY_BOTTOM_PADDING -
      SCRY_BODY_FIXED_HEIGHT -
      stackDepth;
    const portraitCardWidth = Math.min(
      preferredCardWidth,
      Math.max(92, (zoneWidth - 20) / maxCardWidthRatio),
      Math.max(1, availableCardRowsHeight / 2 / maxCardHeightRatio),
    );
    const cardSizes = new Map(
      cards.map((card) => [card.id, this.promptCardDisplayDimensions(card, portraitCardWidth)]),
    );
    const cardWidth = Math.max(...[...cardSizes.values()].map((size) => size.width));
    const cardHeight = Math.max(...[...cardSizes.values()].map((size) => size.height));
    body.sortableChildren = true;
    const byId = new Map(cards.map((card) => [card.id, card]));
    const poolLabel = promptText("CARDS TO PLACE", 11, this.theme.appTheme["muted-foreground"], {
      weight: "700",
    });
    poolLabel.position.set(0, 2);
    body.addChild(poolLabel);
    const poolHeight = cardHeight + 20;
    const pool = new Rectangle(0, 24, poolWidth, poolHeight);
    const poolSpacing = cardWidth + PROMPT_CARD_GAP;
    const poolIds = this.scryItems.pool ?? [];
    const poolContentWidth = CARD_TILE_EDGE_INSET * 2 + poolIds.length * poolSpacing + cardWidth;
    this.scryPoolScrollMax = Math.max(0, poolContentWidth - poolWidth);
    if (this.scryPoolScrollToEnd) {
      this.scryPoolScrollOffset = this.scryPoolScrollMax;
      this.scryPoolScrollToEnd = false;
    }
    this.scryPoolScrollOffset = Math.min(this.scryPoolScrollOffset, this.scryPoolScrollMax);
    const poolLayer = new Container();
    poolLayer.eventMode = "static";
    poolLayer.sortableChildren = true;
    const poolMask = new Graphics()
      .rect(pool.x, pool.y, pool.width, pool.height)
      .fill({ color: hexToNum(this.theme.appTheme.foreground) });
    body.addChild(poolMask);
    poolLayer.mask = poolMask;
    body.addChild(poolLayer);
    const poolBg = new Graphics()
      .roundRect(pool.x, pool.y, pool.width, pool.height, 8)
      .fill({ color: hexToNum(this.theme.appTheme.background), alpha: 0.6 })
      .stroke({ color: hexToNum(this.theme.appTheme["muted-foreground"]), width: 2, alpha: 0.45 });
    poolLayer.addChild(poolBg);
    const poolMarker = new Graphics()
      .roundRect(pool.x, pool.y, pool.width, pool.height, 8)
      .stroke({ color: hexToNum(this.theme.gameTheme.cardRing), width: 2.5 });
    poolMarker.eventMode = "none";
    poolMarker.visible = false;
    poolMarker.zIndex = 500;
    poolLayer.addChild(poolMarker);
    const poolScrollThumb = new Graphics();
    poolScrollThumb.eventMode = "none";
    poolScrollThumb.zIndex = 501;
    poolLayer.addChild(poolScrollThumb);
    poolLayer.on("wheel", (event: FederatedWheelEvent) => this.scrollScryPool(event));
    const contentDropX = CARD_TILE_EDGE_INSET + poolIds.length * poolSpacing;
    const visibleDropX = Math.max(
      pool.x + 4,
      Math.min(contentDropX - this.scryPoolScrollOffset, pool.x + pool.width - cardWidth - 4),
    );
    this.dropZones.push({
      id: "pool",
      rect: pool,
      container: body,
      visual: poolBg,
      dropX: visibleDropX,
      dropY: pool.y + 10,
      targetAlpha: 1,
      marker: poolMarker,
    });
    if (this.scryPoolScrollMax > 0) {
      const trackWidth = pool.width - 24;
      const thumbWidth = Math.max(24, trackWidth * (poolWidth / poolContentWidth));
      const travel = trackWidth - thumbWidth;
      poolScrollThumb
        .clear()
        .roundRect(
          pool.x + 12 + travel * (this.scryPoolScrollOffset / this.scryPoolScrollMax),
          pool.y + pool.height - 6,
          thumbWidth,
          3,
          2,
        )
        .fill({ color: hexToNum(this.theme.appTheme["muted-foreground"]), alpha: 0.85 });
    }
    poolIds.forEach((id, index) => {
      const card = byId.get(id);
      const cardSize = cardSizes.get(id);
      if (!card || !cardSize) return;
      const tile = this.createCardTile(
        card,
        this.scrySelectedId === id,
        false,
        cardSize.width,
        cardSize.height,
        () => {
          this.scrySelectedId = this.scrySelectedId === id ? null : id;
          this.rebuild();
        },
      );
      const offsetX = (cardWidth - cardSize.width) / 2;
      const offsetY = (cardHeight - cardSize.height) / 2;
      const contentX = CARD_TILE_EDGE_INSET + index * poolSpacing + offsetX;
      this.scryCardOffsets.set(id, { x: offsetX, y: offsetY });
      this.scryPoolSlotX.set(id, contentX);
      this.makeDraggable(
        tile,
        (x, y) => this.dropScryCard(id, x, y),
        (x, y) => this.scryDropPosition(id, x, y),
      );
      this.placeScryCardTile(
        poolLayer,
        tile,
        id,
        contentX - this.scryPoolScrollOffset,
        pool.y + 10 + offsetY,
      );
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
        const cardSize = cardSizes.get(id);
        if (!card || !cardSize) return;
        const tile = this.createCardTile(
          card,
          this.scrySelectedId === id,
          cardIndex !== ids.length - 1,
          cardSize.width,
          cardSize.height,
          cardIndex === ids.length - 1
            ? () => {
                this.scrySelectedId = this.scrySelectedId === id ? null : id;
                this.rebuild();
              }
            : undefined,
        );
        const offsetX = (cardWidth - cardSize.width) / 2;
        const offsetY = (cardHeight - cardSize.height) / 2;
        const tileX = rect.x + (rect.width - cardWidth) / 2 + offsetX;
        const tileY = rect.y + 10 + cardIndex * 16 + offsetY;
        this.scryCardOffsets.set(id, { x: offsetX, y: offsetY });
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

  protected scrollScryPool(event: FederatedWheelEvent): void {
    if (this.scryPoolScrollMax <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const dominant = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const rawDelta = event.deltaMode === 1 ? dominant * MODAL_SCROLL_LINE_HEIGHT : dominant;
    const delta = Math.max(
      -MODAL_SCROLL_MAX_STEP,
      Math.min(MODAL_SCROLL_MAX_STEP, rawDelta * MODAL_SCROLL_SCALE),
    );
    this.setScryPoolScrollOffset(this.scryPoolScrollOffset + delta);
  }

  protected setScryPoolScrollOffset(offset: number): void {
    this.scryPoolScrollOffset = Math.max(0, Math.min(this.scryPoolScrollMax, offset));
    for (const [cardId, tile] of this.scryCardTiles) {
      if (this.drag?.item === tile) continue;
      if (this.scryCardSource(cardId) !== "pool") continue;
      const contentX = this.scryPoolSlotX.get(cardId);
      if (contentX === undefined) continue;
      gsap.killTweensOf(tile.position);
      tile.x = contentX - this.scryPoolScrollOffset;
    }
  }

  protected dropScryCard(cardId: string, x: number, y: number): void {
    const target = this.findDropZone(x, y);
    if (!target) {
      this.rebuild();
      return;
    }
    this.moveScryCard(cardId, target.id);
  }

  protected moveScryCard(cardId: string, targetId: string): void {
    const source = this.scryCardSource(cardId);
    if (!source || source === targetId) {
      this.rebuild();
      return;
    }
    this.captureScryCardPositions();
    this.scryItems[source] = this.scryItems[source]!.filter((id) => id !== cardId);
    this.scryItems[targetId] = [...(this.scryItems[targetId] ?? []), cardId];
    if (targetId === "pool") this.scryPoolScrollToEnd = true;
    this.scrySelectedId = null;
    this.rebuild();
  }

  protected scryCardSource(cardId: string): string | undefined {
    return Object.entries(this.scryItems).find(([, ids]) => ids.includes(cardId))?.[0];
  }

  protected scryDropPosition(
    cardId: string,
    x: number,
    y: number,
  ): { x: number; y: number } | null {
    const target = this.findDropZone(x, y);
    if (!target || target.id === this.scryCardSource(cardId)) return null;
    const offset = this.scryCardOffsets.get(cardId);
    return {
      x: target.dropX + (offset?.x ?? 0),
      y: target.dropY + (offset?.y ?? 0),
    };
  }

  protected captureScryCardPositions(): void {
    this.scryPreviousPositions.clear();
    for (const [cardId, tile] of this.scryCardTiles) {
      const position = tile.toGlobal({ x: 0, y: 0 });
      this.scryPreviousPositions.set(cardId, { x: position.x, y: position.y });
    }
  }

  protected placeScryCardTile(
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

  protected animateScryLayout(): void {
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

  protected clearScryCardTiles(): void {
    for (const tile of this.scryCardTiles.values()) gsap.killTweensOf(tile.position);
    this.scryCardTiles.clear();
    this.scryCardOffsets.clear();
    this.scryPoolSlotX.clear();
  }

  protected scryDestinationLabel(destination: ScryDestination): string {
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

  protected addScryDestinationHint(
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

  protected scryDestinationHint(destination: ScryDestination): string {
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
  protected renderDamageOrder(): void {
    const damageOrder = this.spec!.damageOrder;
    if (!damageOrder) return;
    const width = this.modalPromptWidth(540);
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
    const { body, footer } = this.createModalShell(width, height, presentation, true, 60);
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
            selected ? this.theme.gameTheme.cardSelection : this.theme.appTheme.background,
          ),
          alpha: selected ? 0.11 : 0.58,
        })
        .stroke({
          color: hexToNum(
            selected ? this.theme.gameTheme.cardSelection : this.theme.appTheme.border,
          ),
          width: selected ? 2 : 1,
          alpha: selected ? 0.9 : 0.8,
        });
      const rankBackground = new Graphics().circle(25, 31, 14).fill({
        color: hexToNum(selected ? this.theme.gameTheme.cardSelection : this.theme.appTheme.muted),
        alpha: selected ? 1 : 0.72,
      });
      const rank = promptText(
        selected ? String(index + 1) : "—",
        14,
        selected
          ? readableTextColor(
              this.theme.gameTheme.cardSelection,
              this.theme.appTheme.background,
              this.theme.appTheme.foreground,
            )
          : this.theme.appTheme.foreground,
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
        selected ? this.theme.gameTheme.cardSelection : this.theme.appTheme["muted-foreground"],
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

  protected renderCombatDamage(input: ChooseCombatDamageAssignmentInput): void {
    const width = this.modalPromptWidth(600);
    const availableWidth = width - PANEL_PADDING * 2;
    const assignees = [...input.blockerIds, ...(input.defenderId ? [input.defenderId] : [])];
    const height = Math.min(this.viewportHeight - 24, 284 + assignees.length * 70);
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
    const { body, footer } = this.createModalShell(width, height, presentation, true, 64, 38);
    const assigned = Object.values(this.damageAssigned).reduce((sum, damage) => sum + damage, 0);
    const remaining = input.totalDamage - assigned;
    const waiting = this.spec!.action.isWaitingForResponse;
    const statusColor =
      remaining === 0 ? this.theme.gameTheme.success : this.theme.appTheme.foreground;
    const status = promptText(
      remaining === 0 ? "Ready to assign" : `${remaining} damage left`,
      14,
      statusColor,
      { weight: "700" },
    );
    status.position.set(0, 2);
    const allocation = promptText(
      `${assigned} of ${input.totalDamage} assigned`,
      10,
      this.theme.appTheme["muted-foreground"],
      { weight: "600" },
    );
    allocation.anchor.set(1, 0);
    allocation.position.set(availableWidth, 6);
    const progressTrack = new Graphics()
      .roundRect(0, 28, availableWidth, 6, 3)
      .fill({ color: hexToNum(this.theme.appTheme.muted), alpha: 0.72 });
    body.addChild(status, allocation, progressTrack);
    if (assigned > 0) {
      const progressWidth = Math.min(
        availableWidth,
        (availableWidth * assigned) / input.totalDamage,
      );
      const progress = new Graphics()
        .roundRect(0, 28, progressWidth, 6, 3)
        .fill({ color: hexToNum(statusColor), alpha: 0.92 });
      body.addChild(progress);
    }
    const guidance = promptText(
      input.defenderId
        ? "Assign lethal damage in order, then send the rest to the defender."
        : "Assign lethal damage to each blocker in order.",
      10,
      this.theme.appTheme["muted-foreground"],
      { weight: "500", width: availableWidth, truncate: true },
    );
    guidance.position.set(0, 43);
    body.addChild(guidance);

    let y = 66;
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
      const complete = id === input.defenderId ? remaining === 0 : lethalReached;
      const rowColor = lethalReached
        ? this.theme.gameTheme.promptAction.attackAction
        : complete
          ? this.theme.gameTheme.success
          : damage > 0
            ? this.theme.gameTheme.cardRing
            : this.theme.appTheme.border;
      const rowBg = new Graphics()
        .roundRect(0, y, availableWidth, 62, 9)
        .fill({
          color: hexToNum(complete ? rowColor : this.theme.appTheme.background),
          alpha: complete ? 0.09 : 0.56,
        })
        .stroke({
          color: hexToNum(rowColor),
          width: 1,
          alpha: blocked ? 0.5 : complete || damage > 0 ? 0.86 : 1,
        });
      rowBg.eventMode = "static";
      rowBg.cursor = "default";
      rowBg.accessible = true;
      rowBg.accessibleTitle = `Damage assigned to ${label}: ${damage}${
        lethalReached
          ? ", lethal damage assigned"
          : lethal == null
            ? ""
            : `, lethal damage ${lethal}`
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

      const orderBadge = new Graphics()
        .roundRect(10, y + 19, 24, 24, 12)
        .fill({
          color: hexToNum(complete || damage > 0 ? rowColor : this.theme.appTheme.muted),
          alpha: complete || damage > 0 ? 0.24 : 0.72,
        })
        .stroke({
          color: hexToNum(rowColor),
          width: 1,
          alpha: complete || damage > 0 ? 0.75 : 0.55,
        });
      const order = promptText(String(index + 1), 10, this.theme.appTheme.foreground, {
        weight: "700",
      });
      order.anchor.set(0.5);
      order.position.set(22, y + 31);
      const defender = this.spec!.gameView.players.find((player) => player.id === id);
      const card = this.spec!.gameView.battlefield.find((candidate) => candidate.id === id);
      const name = promptText(label, 12, this.theme.appTheme.foreground, {
        weight: "600",
        width: availableWidth - 260,
        truncate: true,
      });
      name.position.set(44, y + 10);
      const detail = defender
        ? `DEFENDER · ${defender.life} → ${defender.life - damage} life`
        : `${card?.power ?? "?"}/${card?.toughness ?? "?"}${card?.damage ? ` · ${card.damage} marked` : ""}${
            lethalReached ? " · LETHAL ASSIGNED" : ""
          }`;
      const detailText = promptText(
        detail,
        10,
        lethalReached
          ? this.theme.gameTheme.promptAction.attackAction
          : this.theme.appTheme["muted-foreground"],
        {
          weight: lethalReached ? "700" : "500",
          width: availableWidth - 260,
          truncate: true,
        },
      );
      detailText.position.set(44, y + 36);
      body.addChild(orderBadge, order, name, detailText);

      const lethalDisabled = waiting || blocked || lethalReached || remaining <= 0;
      if (lethal != null) {
        const lethalButton = this.makeButton(
          `LETHAL ${lethal}${lethalReached ? " ✓" : ""}`,
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
            disabled: lethalDisabled,
            compact: true,
            width: 80,
            height: 36,
            fontSize: 9,
            letterSpacing: 0.3,
            borderColor: lethalReached
              ? this.theme.gameTheme.promptAction.attackAction
              : this.theme.appTheme.border,
          },
        );
        lethalButton.alpha = lethalDisabled ? 0.46 : 1;
        lethalButton.position.set(availableWidth - 204, y + 13);
        body.addChild(lethalButton);
      }

      const minusDisabled = waiting || damage <= 0;
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
          disabled: minusDisabled,
          compact: true,
          width: 32,
          height: 36,
        },
      );
      minus.alpha = minusDisabled ? 0.46 : 1;
      const amountBackground = new Graphics()
        .roundRect(availableWidth - 78, y + 13, 34, 36, 7)
        .fill({ color: hexToNum(this.theme.appTheme.muted), alpha: 0.68 });
      const amount = promptText(String(damage), 14, this.theme.appTheme.foreground, {
        weight: "700",
      });
      amount.anchor.set(0.5);
      const plusDisabled = waiting || blocked || remaining <= 0;
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
          disabled: plusDisabled,
          compact: true,
          width: 32,
          height: 36,
        },
      );
      plus.alpha = plusDisabled ? 0.46 : 1;
      minus.position.set(availableWidth - 114, y + 13);
      amount.position.set(availableWidth - 61, y + 31);
      plus.position.set(availableWidth - 42, y + 13);
      body.addChild(minus, amountBackground, amount, plus);
      y += 68;
    });

    const legal = remaining === 0 && this.damageLegallyOrdered(input, assignees);
    const resetDisabled = waiting || assigned === 0;
    const reset = this.makeButton(
      "CLEAR",
      () => {
        this.damageAssigned = {};
        this.rebuild();
      },
      {
        title: "Clear damage assignments",
        outline: true,
        disabled: resetDisabled,
      },
    );
    reset.alpha = resetDisabled ? 0.46 : 1;
    reset.position.set(0, 0);
    const auto = this.makeButton(
      "AUTO",
      () => {
        this.autoAssignDamage(input, assignees);
        this.rebuild();
      },
      {
        title: "Assign lethal damage in order, then assign the rest",
        outline: true,
        disabled: waiting,
      },
    );
    auto.alpha = waiting ? 0.46 : 1;
    auto.position.set(reset.buttonWidth + 8, 0);
    const confirmDisabled = waiting || !legal;
    const confirm = this.makeButton(
      "ASSIGN DAMAGE",
      () =>
        this.spec!.respond({
          type: "combatDamageAssignmentDecision",
          assignments: assignees.map((assigneeId) => ({
            assigneeId,
            damage: this.damageAssigned[assigneeId] ?? 0,
          })),
        }),
      { disabled: confirmDisabled, width: 142 },
    );
    confirm.alpha = confirmDisabled ? 0.56 : 1;
    confirm.position.set(availableWidth - confirm.buttonWidth, 0);
    footer.addChild(reset, auto, confirm);
  }

  protected combatLabel(id: string): string {
    return (
      this.spec!.gameView.battlefield.find((card) => card.id === id)?.identity.name ??
      this.spec!.gameView.players.find((player) => player.id === id)?.name ??
      id
    );
  }

  protected combatLethal(id: string, deathtouch: boolean): number {
    const card = this.spec!.gameView.battlefield.find((candidate) => candidate.id === id);
    if (!card) return 0;
    if (card.types?.includes("Planeswalker")) {
      return Math.max(0, card.counters?.LOYALTY ?? card.counters?.Loyalty ?? 0);
    }
    if (deathtouch) return 1;
    return Math.max(0, parseCombatNumber(card.toughness) - (card.damage ?? 0));
  }

  protected normalizeDamage(input: ChooseCombatDamageAssignmentInput, assignees: string[]): void {
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

  protected damageLegallyOrdered(
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

  protected autoAssignDamage(input: ChooseCombatDamageAssignmentInput, assignees: string[]): void {
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

  protected renderDice(
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

  protected renderRollResults(
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
            sides: 6,
            value: "—",
            round: 0,
            highlighted: false,
            ignored: false,
          },
        ];
    const rollEntries = visibleEntries.map((entry, index) => {
      const seed = rollSeed(this.spec?.currentPrompt?.promptId, entry.round, index);
      return { entry, index, seed, trajectory: rollTrajectory(seed) };
    });
    this.rollDurationMs = Math.max(
      ...rollEntries.map(({ trajectory }) => trajectory.flightMs + ROLL_IMPACT_MS + ROLL_SETTLE_MS),
    );
    this.rollSettled = !animationsEnabled() || this.rollElapsedMs >= this.rollDurationMs;
    const width = this.modalPromptWidth(620);
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
      footerHeight,
    );
    const availableWidth = width - PANEL_PADDING * 2;
    const bodyHeight = Math.max(0, height - bodyTop - footerHeight - MODAL_BODY_BOTTOM_PADDING);
    const resultBottom = winner ? Math.max(0, bodyHeight - 46) : bodyHeight;
    const throwBottom = winner ? resultBottom - 10 : bodyHeight - 12;
    const arenaTop = 8;
    const arenaHeight = Math.max(dieSize + 32, throwBottom - arenaTop);
    const cellWidth = availableWidth / landingColumns;
    const cellHeight = arenaHeight / landingRows;
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
    rollEntries.forEach(({ entry, index, seed, trajectory }) => {
      const column = index % landingColumns;
      const row = Math.floor(index / landingColumns);
      const rowItemCount = Math.min(landingColumns, visibleEntries.length - row * landingColumns);
      const rowStartX = (availableWidth - rowItemCount * cellWidth) / 2;
      const x = rowStartX + (column + 0.5) * cellWidth;
      const slotY = arenaTop + (row + 0.5) * cellHeight;
      const y = Math.max(dieSize / 2 + 8, Math.min(throwBottom - dieSize / 2 - 24, slotY));
      const minX = dieSize / 2 + 8;
      const maxX = availableWidth - dieSize / 2 - 8;
      const minY = arenaTop + dieSize / 2;
      const maxY = Math.max(minY, throwBottom - dieSize / 2 - 12);
      const startX = Math.max(minX, Math.min(maxX, x + trajectory.startX));
      const startY = Math.max(minY, Math.min(maxY, y + trajectory.startY));
      const playerColor = this.rollPlayerColor(entry.playerId);
      const token = createRollToken({
        sides: entry.sides,
        size: dieSize,
        fill: this.theme.appTheme.card,
        border: entry.ignored ? this.theme.appTheme.destructive : playerColor,
        foreground: this.theme.appTheme.foreground,
      });
      token.root.position.set(x, y);
      setRollTokenValue(token, entry.value);
      rollLayer.addChild(token.root);
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
        sides: entry.sides,
        seed,
        trajectory,
        baseX: x,
        baseY: y,
        startX,
        startY,
        restingRotation: 0,
        ignored: entry.ignored,
        ignoredMark,
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
      const resultLabel = promptText("RESULT", 9, winnerColor, {
        weight: "700",
        letterSpacing: 0.8,
      });
      resultLabel.anchor.set(0.5, 0);
      resultLabel.position.set((width - PANEL_PADDING * 2) / 2, resultBottom + 2);
      const winnerText = promptText(
        this.rollSettled ? winnerLabel : "Rolling…",
        16,
        this.theme.appTheme.foreground,
        { weight: "700" },
      );
      winnerText.anchor.set(0.5, 0);
      winnerText.position.set((width - PANEL_PADDING * 2) / 2, resultBottom + 17);
      this.rollHighlightText = winnerText;
      this.rollHighlightLabel = winnerLabel;
      body.addChild(resultLabel, winnerText);
    }
    const confirm = this.makeButton("CONTINUE", onConfirm, {
      disabled: !this.rollSettled,
      width: 120,
    });
    this.rollConfirm = confirm;
    confirm.position.set(width - PANEL_PADDING * 2 - confirm.buttonWidth, 0);
    footer.addChild(confirm);
    this.startRollAnimation();
  }

  protected rollPlayerColor(playerId: string | undefined): string {
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

  protected startRollAnimation(): void {
    if (!animationsEnabled() || this.rollSettled) {
      this.settleRollVisuals();
      return;
    }
    const timeline = gsap.timeline({ paused: true });
    this.rollTimeline = timeline;
    for (const visual of this.rollVisuals) {
      const trajectory = visual.trajectory;
      const finalRotation =
        trajectory.spinDirection * trajectory.turns * Math.PI * 2 + visual.restingRotation;
      const controlX = (visual.startX + visual.baseX) / 2 + trajectory.controlX;
      const controlY = Math.min(visual.startY, visual.baseY) + trajectory.controlY;
      visual.token.root.position.set(visual.startX, visual.startY);
      visual.token.root.alpha = 1;
      visual.token.root.rotation = visual.restingRotation - trajectory.spinDirection * 0.45;
      visual.token.root.scale.set(0.92);
      const landingAt = trajectory.flightMs / 1000;
      timeline.to(
        visual.token.root,
        {
          rotation: finalRotation,
          pixi: { scaleX: 1, scaleY: 1 },
          motionPath: {
            path: [
              { x: visual.startX, y: visual.startY },
              { x: controlX, y: controlY },
              { x: visual.baseX, y: visual.baseY },
            ],
            curviness: 1,
          },
          duration: trajectory.flightMs / 1000,
          ease: "power2.out",
        },
        0,
      );
      timeline.to(
        visual.token.root,
        {
          y: visual.baseY + 2,
          rotation: finalRotation + trajectory.spinDirection * 0.04,
          pixi: { scaleX: 1.04, scaleY: 0.96 },
          duration: ROLL_IMPACT_MS / 1000,
          ease: "power1.out",
        },
        landingAt,
      );
      timeline.to(
        visual.token.root,
        {
          x: visual.baseX,
          y: visual.baseY,
          rotation: finalRotation,
          alpha: visual.ignored ? 0.42 : 1,
          pixi: { scaleX: 1, scaleY: 1 },
          duration: ROLL_SETTLE_MS / 1000,
          ease: "back.out(1.3)",
        },
        landingAt + ROLL_IMPACT_MS / 1000,
      );
      if (visual.ignoredMark) {
        timeline.to(
          visual.ignoredMark,
          { alpha: 1, duration: 0.12, ease: "power2.out" },
          landingAt + ROLL_IMPACT_MS / 1000,
        );
      }
    }
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

  protected settleRollVisuals(): void {
    this.rollSettled = true;
    for (const visual of this.rollVisuals) {
      visual.token.root.position.set(visual.baseX, visual.baseY);
      visual.token.root.rotation = visual.restingRotation;
      visual.token.root.scale.set(1);
      visual.token.root.alpha = visual.ignored ? 0.42 : 1;
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

  protected stopRollAnimation(): void {
    this.rollTimeline?.kill();
    this.rollTimeline = null;
  }
  protected syncRollVisuals(): void {
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
      const elapsedMs = this.rollElapsedMs;
      setRollTokenValue(
        visual.token,
        elapsedMs >= visual.trajectory.flightMs
          ? visual.finalValue
          : rollingDieValue(visual.sides, Math.max(0, elapsedMs), visual.seed),
      );
    }
  }

  protected renderGameOver(): void {
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
}
