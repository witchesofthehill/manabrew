import type {
  PromptLayerPresentation,
  ScryPromptHint,
  ScryPromptLayout,
} from "./PromptLayerPresentation";

export class DesktopPromptLayerPresentation implements PromptLayerPresentation {
  readonly actionStyle = "full";
  readonly modalBodyFit = "scroll";
  readonly cardLayout = "grid";
  readonly selectionRowHeight = 56;
  readonly selectionRowPitch = 66;
  readonly scryHint: ScryPromptHint = {
    centerOffsetY: 8,
    deckSize: 42,
    deckOffsetX: 4,
    cardScale: 1,
    arrowSize: 26,
    arrowOffsetX: 17,
    arrowOffsetY: 24,
    iconSize: 44,
    fontSize: 11,
    textOffsetY: 32,
  };

  modalHeight(_viewportHeight: number, requestedHeight: number): number {
    return requestedHeight;
  }

  modalPromptWidth(
    viewportWidth: number,
    maxWidth: number,
    sourceWidth: number,
    sourceGap: number,
    hasSource: boolean,
  ): number {
    if (!hasSource) return Math.min(maxWidth, viewportWidth);
    return Math.min(maxWidth, Math.max(0, viewportWidth - sourceWidth - sourceGap));
  }

  selectionColumns(): number {
    return 1;
  }

  cardMaxHeight(): number {
    return Number.POSITIVE_INFINITY;
  }

  reorderCardMaxHeight(): number {
    return Number.POSITIVE_INFINITY;
  }

  colorChoiceLayout(colorCount: number): {
    columns: number;
    buttonWidth: number;
    buttonHeight: number;
    grid: boolean;
  } {
    return { columns: colorCount, buttonWidth: 72, buttonHeight: 64, grid: false };
  }

  numberControlLayout(): {
    gap: number;
    edgeWidth: number;
    stepWidth: number;
    minimumValueWidth: number;
  } {
    return { gap: 8, edgeWidth: 58, stepWidth: 46, minimumValueWidth: 104 };
  }

  scryLayout(
    _viewportHeight: number,
    cardCount: number,
    battlefieldCardWidth: number,
  ): ScryPromptLayout {
    return {
      stackDepth: Math.min(64, Math.max(0, cardCount - 1) * 16),
      footerHeight: 64,
      cardMaxHeight: Number.POSITIVE_INFINITY,
      destinationPortraitWidth: battlefieldCardWidth,
      cardHints: true,
      overlapPoolCards: false,
      zoneGap: 38,
      destinationVerticalPadding: 48,
      labelOffset: 22,
      hint: this.scryHint,
    };
  }
}
