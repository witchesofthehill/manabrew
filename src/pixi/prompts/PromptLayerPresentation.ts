export interface ScryPromptHint {
  centerOffsetY: number;
  deckSize: number;
  deckOffsetX: number;
  cardScale: number;
  arrowSize: number;
  arrowOffsetX: number;
  arrowOffsetY: number;
  iconSize: number;
  fontSize: number;
  textOffsetY: number;
}

export interface ScryPromptLayout {
  stackDepth: number;
  footerHeight: number;
  cardMaxHeight: number;
  destinationPortraitWidth: number;
  cardHints: boolean;
  overlapPoolCards: boolean;
  zoneGap: number;
  destinationVerticalPadding: number;
  labelOffset: number;
  hint: ScryPromptHint;
}

export interface PromptLayerPresentation {
  readonly actionStyle: "full" | "minimal";
  readonly modalBodyFit: "scroll" | "scale";
  readonly cardLayout: "grid" | "horizontal-scroll";
  readonly selectionRowHeight: number;
  readonly scryHint: ScryPromptHint;
  readonly selectionRowPitch: number;
  modalHeight(viewportHeight: number, requestedHeight: number, viewportMargin: number): number;
  modalPromptWidth(
    viewportWidth: number,
    maxWidth: number,
    sourceWidth: number,
    sourceGap: number,
    hasSource: boolean,
  ): number;
  selectionColumns(allSingleChoice: boolean): number;
  cardMaxHeight(viewportHeight: number): number;
  reorderCardMaxHeight(viewportHeight: number, verticalReserve: number): number;
  colorChoiceLayout(
    colorCount: number,
    availableWidth: number,
    gap: number,
  ): { columns: number; buttonWidth: number; buttonHeight: number; grid: boolean };
  numberControlLayout(availableWidth: number): {
    gap: number;
    edgeWidth: number;
    stepWidth: number;
    minimumValueWidth: number;
  };
  scryLayout(
    viewportHeight: number,
    cardCount: number,
    battlefieldCardWidth: number,
  ): ScryPromptLayout;
}
