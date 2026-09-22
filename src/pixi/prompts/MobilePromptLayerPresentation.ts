import type {
  PromptLayerPresentation,
  ScryPromptHint,
  ScryPromptLayout,
} from "./PromptLayerPresentation";

export class MobilePromptLayerPresentation implements PromptLayerPresentation {
  readonly actionStyle = "minimal";
  readonly modalBodyFit = "scale";
  readonly cardLayout = "horizontal-scroll";
  readonly selectionRowHeight = 50;
  readonly selectionRowPitch = 58;
  readonly scryHint: ScryPromptHint = {
    centerOffsetY: 4,
    deckSize: 32,
    deckOffsetX: 3,
    cardScale: 0.72,
    arrowSize: 20,
    arrowOffsetX: 13,
    arrowOffsetY: 18,
    iconSize: 32,
    fontSize: 10,
    textOffsetY: 22,
  };

  modalHeight(viewportHeight: number, _requestedHeight: number, viewportMargin: number): number {
    return viewportHeight - viewportMargin;
  }

  modalPromptWidth(
    viewportWidth: number,
    _maxWidth: number,
    sourceWidth: number,
    sourceGap: number,
    hasSource: boolean,
  ): number {
    return hasSource ? Math.max(0, viewportWidth - sourceWidth - sourceGap) : viewportWidth;
  }

  selectionColumns(allSingleChoice: boolean): number {
    return allSingleChoice ? 2 : 1;
  }

  cardMaxHeight(viewportHeight: number): number {
    return Math.max(96, viewportHeight - 180);
  }

  reorderCardMaxHeight(viewportHeight: number, verticalReserve: number): number {
    return Math.max(96, viewportHeight - verticalReserve);
  }

  colorChoiceLayout(
    colorCount: number,
    availableWidth: number,
    gap: number,
  ): { columns: number; buttonWidth: number; buttonHeight: number; grid: boolean } {
    const columns = Math.min(3, colorCount);
    return {
      columns,
      buttonWidth: (availableWidth - gap * (columns - 1)) / Math.max(1, columns),
      buttonHeight: 52,
      grid: true,
    };
  }

  numberControlLayout(): {
    gap: number;
    edgeWidth: number;
    stepWidth: number;
    minimumValueWidth: number;
  } {
    return { gap: 6, edgeWidth: 44, stepWidth: 40, minimumValueWidth: 52 };
  }

  scryLayout(
    viewportHeight: number,
    cardCount: number,
    battlefieldCardWidth: number,
  ): ScryPromptLayout {
    return {
      stackDepth: Math.min(16, Math.max(0, cardCount - 1) * 16),
      footerHeight: 52,
      cardMaxHeight: Math.max(72, viewportHeight - 280),
      destinationPortraitWidth: Math.min(42, battlefieldCardWidth),
      cardHints: false,
      overlapPoolCards: true,
      zoneGap: 28,
      destinationVerticalPadding: 10,
      labelOffset: 20,
      hint: this.scryHint,
    };
  }
}
