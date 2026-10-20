import type { CardDto } from "@/protocol/game";
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { CardInteractionPanel } from "@/lib/cardRenderGeometry";
import { i18n } from "@/i18n/i18n";
import { msg } from "@lingui/core/macro";
import { roomDoorState } from "@/components/game/cardPresentation";
import {
  matchRulesEntry,
  rulesTextEntries,
  type RulesPreviewDisplay,
} from "@/pixi/cardPreview/rulesCardPreviewPresentation";

export function previewActionFace(action: HandActionOption): number | undefined {
  if (action.mode?.type === "alternative" && action.mode.cost === "prototype") return 1;
  if (action.faceIndex !== undefined) return action.faceIndex;
  if (action.mode?.type === "unlockDoor") return action.mode.door === "left" ? 0 : 1;
  if (action.mode?.type === "adventure") return 1;
  if (action.mode?.type === "roomRightSplit" || action.mode?.type === "backFaceLand") return 1;
  return undefined;
}

export function previewOwnsAction(
  action: HandActionOption,
  display: RulesPreviewDisplay,
  battle: boolean,
): boolean {
  return (
    !display.faceless &&
    (!battle || (previewActionFace(action) ?? display.liveFaceIndex) === display.faceIndex)
  );
}

export function levelActionPanel(
  action: HandActionOption,
  panels: readonly CardInteractionPanel[],
  localize: (text: string, faceIndex: number) => string,
): string | undefined {
  if (action.kind !== "ability") return undefined;
  const bands = panels.filter(
    (panel) =>
      panel.kind === "level" &&
      (action.faceIndex === undefined || panel.faceIndex === action.faceIndex),
  );
  if (action.levelUp === "creature") return bands[0]?.id;
  const text = action.abilityText;
  if (!text) return undefined;
  const matching = bands.filter(
    (panel) =>
      matchRulesEntry(
        localize(text, panel.faceIndex),
        rulesTextEntries(panel.level?.rulesText ?? "", null),
        action.cost,
      ) !== null,
  );
  return matching.length === 1 ? matching[0]!.id : undefined;
}

export function levelBandActive(range: string, card: CardDto): boolean | undefined {
  if (card.zone !== "battlefield") return undefined;
  const match = /^(\d+)(?:\s*[-–]\s*(\d+)|(\+))?$/.exec(range.trim());
  if (!match) return undefined;
  const level = card.counters.Level ?? 0;
  return (
    level >= Number(match[1]) && (match[3] !== undefined || level <= Number(match[2] ?? match[1]))
  );
}

export function previewPanelActive(
  card: CardDto,
  panel: Pick<CardInteractionPanel, "faceIndex" | "level">,
  layout?: string,
): boolean | undefined {
  if (panel.level?.range) return levelBandActive(panel.level.range, card);
  if (layout === "room") {
    const state = roomDoorState(card);
    return state === undefined ? undefined : (state & (1 << panel.faceIndex)) !== 0;
  }
  if (
    layout === "prototype" &&
    (card.zone === "battlefield" || card.zone === undefined) &&
    card.isPrototyped !== undefined
  )
    return (panel.faceIndex === 1) === card.isPrototyped;
  return undefined;
}

export function caseSectionActive(
  card: CardDto,
  kind: "base" | "toSolve" | "solved",
): boolean | undefined {
  if (card.zone !== "battlefield" || card.isSolved === undefined || kind === "base")
    return undefined;
  return kind === "solved" ? card.isSolved : !card.isSolved;
}

export function previewPanelState(
  card: CardDto,
  panel: Pick<CardInteractionPanel, "faceIndex" | "level">,
  layout?: string,
): string | undefined {
  const active = previewPanelActive(card, panel, layout);
  if (layout === "room" && "zoneId" in card && card.zoneId === "stack") return undefined;
  if (layout === "room" && active !== undefined)
    return active ? i18n._(msg`Unlocked`) : i18n._(msg`Locked`);
  if (panel.level?.range && active !== undefined)
    return active ? i18n._(msg`Active level`) : i18n._(msg`Inactive level`);
  if (layout === "prototype" && active !== undefined)
    return active ? i18n._(msg`Current characteristics`) : i18n._(msg`Printed alternative`);
  if (layout === "adventure" && card.isOnAdventure !== undefined && panel.faceIndex === 1)
    return card.isOnAdventure ? i18n._(msg`On an Adventure`) : undefined;
  return undefined;
}

export function caseSections(
  display: string,
  canonical: string,
): Array<{ kind: "base" | "toSolve" | "solved"; text: string }> {
  const lines = display.split("\n");
  let kind: "base" | "toSolve" | "solved" = "base";
  return canonical
    .split("\n")
    .map((line, index) => {
      if (/^To solve\s*[—–-]/i.test(line)) kind = "toSolve";
      if (/^Solved\s*[—–-]/i.test(line)) kind = "solved";
      return { kind, text: (lines[index] ?? line).trim() };
    })
    .filter(({ text }) => text.trim());
}

export function suspendState(card: CardDto): string | undefined {
  if (card.isSuspended === undefined) return undefined;
  if (!card.isSuspended && !/\bSuspend\b/i.test(card.text)) return undefined;
  if (!card.isSuspended) return i18n._(msg`Not suspended`);
  const time = card.counters.Time;
  return time === undefined
    ? i18n._(msg`Suspended`)
    : i18n._(msg`Suspended · ${time} time counters`);
}
