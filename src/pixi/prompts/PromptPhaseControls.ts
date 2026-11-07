import { Container, Graphics, Rectangle, type FederatedPointerEvent } from "pixi.js";
import { PHASE_BAR_ENTRIES, PHASES } from "@/components/game/game.constants";
import { togglePhaseStops } from "@/components/game/game.utils";
import type { Theme } from "@/hooks/useTheme";
import { TOUCH_MOVE_SLOP_PX } from "@/lib/responsive";
import { stripUsernameTag } from "@/lib/username";
import { DEFAULT_OPPONENT_STOPS, usePhaseStopStore } from "@/stores/usePhaseStopStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { readableTextColor } from "@/themes/gameTheme";
import {
  getUiControlFloor,
  getUiControlHeight,
  getUiFontSize,
  isTouchUi,
} from "@/themes/typography";
import { hexToNum, mixNum } from "@/pixi/colorUtils";
import { PromptButton } from "./PromptButton";
import { promptText } from "./PromptLayerBase";
import { phaseColumnCount, PromptPlayerPhaseRows } from "./PromptPlayerPhaseRows";
import type { PromptOverlaySpec } from "./prompt.types";

const GAP = 4;
const ROW_GAP = 8;
const INDICATOR_HEIGHT = 4;
const INDICATOR_MARGIN = 3;
const INDICATOR_HIT_HEIGHT = 12;
const OFF_TURN_MIX = 0.55;
const GHOST_MIX = 0.35;
const GHOST_HOVER_MIX = 0.7;
const SET_HOVER_MIX = 0.35;
const PAD = 12;
const HEADER_HEIGHT = 28;
const COLLAPSE_SIZE = 20;

export function phaseTileLayout(width: number) {
  const availableWidth = width - PAD * 2;
  const columns = phaseColumnCount(availableWidth);
  const phaseWidth = (availableWidth - GAP * (columns - 1)) / columns;
  return {
    columns,
    phaseWidth,
    columnX: (index: number) => PAD + (index % columns) * (phaseWidth + GAP),
    columnAt: (x: number) =>
      Math.min(PHASE_BAR_ENTRIES.length - 1, Math.round((x - PAD) / (phaseWidth + GAP))),
  };
}

export class PromptPhaseControls extends Container {
  readonly contentHeight: number;
  private currentTile: Graphics | null = null;

  constructor(
    theme: Theme,
    spec: PromptOverlaySpec,
    width: number,
    onCollapse: () => void,
    maxHeight: number,
  ) {
    super();
    this.label = "promptPhaseControls";
    const content = new Container();
    const stops = usePhaseStopStore.getState();
    const { playerColors } = theme.gameTheme;
    const opponentColors = [playerColors.opponent1, playerColors.opponent2, playerColors.opponent3];
    const opponents = spec.gameView.players.filter((player) => player.id !== spec.localPlayerId);
    const players = [
      { id: spec.localPlayerId, name: "You", color: playerColors.self, stops: stops.selfStops },
      ...opponents.map((player, index) => ({
        id: player.id,
        name: stripUsernameTag(player.name),
        color: opponentColors[index] ?? playerColors.opponent1,
        stops: stops.opponentStops.get(player.id) ?? DEFAULT_OPPONENT_STOPS,
      })),
    ];
    const collapseSize = Math.max(COLLAPSE_SIZE, getUiControlFloor());
    const headerHeight = Math.max(HEADER_HEIGHT, collapseSize + 8);
    const heading = promptText("Phase stops", getUiFontSize("meta"), theme.appTheme.foreground, {
      weight: "700",
    });
    heading.anchor.set(0, 0.5);
    heading.position.set(PAD, headerHeight / 2);
    const collapse = new PromptButton(theme, {
      label: "Hide phase stops",
      labelPlacement: "hidden",
      icon: "lucide-chevron-down",
      iconSize: 14,
      flat: true,
      foreground: theme.appTheme.foreground,
      backgroundColor: theme.appTheme.foreground,
      backgroundAlpha: 0,
      hoverBackgroundAlpha: 0.08,
      width: collapseSize,
      height: collapseSize,
      paddingX: 3,
      onPress: onCollapse,
    });
    collapse.position.set(width - PAD - collapseSize, (headerHeight - collapseSize) / 2);
    const help = new PromptButton(theme, {
      label: "Explain phase stops",
      labelPlacement: "hidden",
      icon: "lucide-circle-help",
      iconSize: 14,
      flat: true,
      foreground: theme.appTheme.foreground,
      backgroundColor: theme.appTheme.foreground,
      backgroundAlpha: 0,
      hoverBackgroundAlpha: 0.08,
      width: collapseSize,
      height: collapseSize,
      paddingX: 3,
      onPress: spec.onOpenPhaseStopsHelp,
    });
    help.position.set(PAD + heading.width + GAP, (headerHeight - collapseSize) / 2);
    content.addChild(heading, help, collapse);
    let fullHeight: number;
    if (usePreferencesStore.getState().phaseStopLayout === "per-player") {
      const rows = new PromptPlayerPhaseRows(theme, spec, players, width - PAD * 2);
      rows.position.set(PAD, headerHeight);
      content.addChild(rows);
      fullHeight = headerHeight + PAD + rows.contentHeight;
    } else {
      const cellHeight = getUiControlHeight();
      const indicatorHeight = Math.max(INDICATOR_HIT_HEIGHT, getUiControlFloor());
      const rowHeight = cellHeight + indicatorHeight * (opponents.length > 0 ? 2 : 1);
      const surface = theme.gameTheme.phaseStrip.background;
      const ink = readableTextColor(
        surface,
        theme.gameTheme.canvas.shadow,
        theme.gameTheme.textOnTinted,
      );
      const turnInk = readableTextColor(
        spec.turnColor,
        theme.gameTheme.canvas.shadow,
        theme.gameTheme.textOnTinted,
      );
      const step = spec.gameView.step;
      const stepShort = PHASES.find((phase) => phase.id === step)?.short;
      const { columns, phaseWidth, columnX } = phaseTileLayout(width);
      const tiles = new Container();
      const currentLayer = new Container();
      content.addChild(tiles, currentLayer);
      PHASE_BAR_ENTRIES.forEach((entry, index) => {
        const current = entry.steps.includes(step);
        const label = promptText(
          current && stepShort ? stepShort : entry.short,
          getUiFontSize("meta"),
          current ? turnInk : ink,
          { weight: "700" },
        );
        const group = new Container();
        group.position.set(
          columnX(index),
          headerHeight + Math.floor(index / columns) * (rowHeight + ROW_GAP),
        );
        group.eventMode = "static";
        group.hitArea = new Rectangle(0, 0, phaseWidth, rowHeight);
        const phaseY = opponents.length > 0 ? indicatorHeight : 0;
        const background = new Graphics()
          .roundRect(0, phaseY, phaseWidth, cellHeight, 4)
          .fill({ color: hexToNum(surface) });
        background.eventMode = "none";
        background.position.copyFrom(group.position);
        tiles.addChild(background);
        if (current) {
          const currentTile = new Graphics()
            .roundRect(0, phaseY, phaseWidth, cellHeight, 4)
            .fill({ color: hexToNum(spec.turnColor) });
          currentTile.eventMode = "none";
          currentTile.pivot.y = phaseY + cellHeight;
          currentTile.position.set(group.x, group.y + phaseY + cellHeight);
          currentLayer.addChild(currentTile);
          this.currentTile = currentTile;
        }
        label.anchor.set(0.5);
        label.position.set(phaseWidth / 2, phaseY + cellHeight / 2);
        group.addChild(label);
        const markerSyncs: Array<() => void> = [];
        const opponentControls = new Container();
        let groupHovered = false;
        players.forEach((player, playerIndex) => {
          const self = playerIndex === 0;
          const enabled = entry.steps.some((step) => player.stops.has(step));
          const markerWidth = self
            ? phaseWidth
            : (phaseWidth - Math.max(0, opponents.length - 1) * GAP) / opponents.length;
          const targetWidth = self ? phaseWidth : phaseWidth / opponents.length;
          const button = new PromptButton(theme, {
            label: `${player.name}: ${entry.label}, ${enabled ? "stop" : "skip"}`,
            labelPlacement: "hidden",
            width: targetWidth,
            height: indicatorHeight,
            paddingX: 0,
            flat: true,
            backgroundAlpha: 0,
            hoverBackgroundAlpha: 0,
            foreground: player.color,
            pressOffsetY: 0,
            onPress: () =>
              togglePhaseStops(entry.steps, player.stops, (step) => {
                if (self) stops.toggleSelfStop(step);
                else stops.toggleOpponentStop(player.id, step);
              }),
          });
          button.position.set(
            self ? 0 : (playerIndex - 1) * targetWidth,
            self ? phaseY + cellHeight : 0,
          );
          const markerY = self
            ? INDICATOR_MARGIN
            : indicatorHeight - INDICATOR_MARGIN - INDICATOR_HEIGHT;
          const seat = hexToNum(player.color);
          const surfaceFill = hexToNum(surface);
          const offTurn = self && spec.gameView.activePlayerId !== spec.localPlayerId;
          const restColor = enabled
            ? offTurn
              ? mixNum(surfaceFill, seat, OFF_TURN_MIX)
              : seat
            : mixNum(surfaceFill, seat, GHOST_MIX);
          const hoverColor = enabled
            ? mixNum(seat, hexToNum(theme.gameTheme.textOnTinted), SET_HOVER_MIX)
            : mixNum(surfaceFill, seat, GHOST_HOVER_MIX);
          const marker = new Graphics();
          marker.position.set(
            (self ? 0 : (playerIndex - 1) * (markerWidth + GAP)) - button.x,
            markerY,
          );
          marker.eventMode = "none";
          let pointerOver = false;
          let focused = false;
          const syncMarker = () => {
            const active = pointerOver || focused;
            marker.visible = enabled || active || groupHovered || isTouchUi();
            marker
              .clear()
              .roundRect(0, 0, markerWidth, INDICATOR_HEIGHT, INDICATOR_HEIGHT / 2)
              .fill({ color: active ? hoverColor : restColor });
          };
          syncMarker();
          markerSyncs.push(syncMarker);
          button.on("pointerover", () => {
            pointerOver = true;
            syncMarker();
          });
          button.on("pointerout", () => {
            pointerOver = false;
            syncMarker();
          });
          button.on("focusin", () => {
            focused = true;
            syncMarker();
          });
          button.on("focusout", () => {
            focused = false;
            syncMarker();
          });
          button.addChild(marker);
          (self ? group : opponentControls).addChild(button);
        });
        group.addChild(opponentControls);
        const setGroupHovered = (hovered: boolean) => {
          groupHovered = hovered;
          for (const sync of markerSyncs) sync();
        };
        group.on("pointerenter", () => setGroupHovered(true));
        group.on("pointerleave", () => setGroupHovered(false));
        content.addChild(group);
      });
      fullHeight =
        headerHeight +
        PAD +
        Math.ceil(PHASE_BAR_ENTRIES.length / columns) * (rowHeight + ROW_GAP) -
        ROW_GAP;
    }
    this.contentHeight = Math.min(fullHeight, Math.max(getUiControlHeight(), maxHeight));
    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, width, this.contentHeight);
    const mask = new Graphics()
      .rect(0, 0, width, this.contentHeight)
      .fill({ color: hexToNum(theme.appTheme.foreground) });
    this.addChild(content, mask);
    content.mask = mask;
    if (fullHeight <= this.contentHeight) return;
    const scroll = (offset: number) => {
      content.y = Math.max(this.contentHeight - fullHeight, Math.min(0, offset));
    };
    this.on("wheel", (event) => {
      event.preventDefault();
      event.stopPropagation();
      scroll(content.y - event.deltaY * (event.deltaMode === 1 ? 16 : 1));
    });
    let pointerId: number | null = null;
    let scrolledPointerId: number | null = null;
    let startY = 0;
    let startOffset = 0;
    this.on("pointerdowncapture", (event: FederatedPointerEvent) => {
      if (event.pointerType !== "touch") return;
      pointerId = event.pointerId;
      scrolledPointerId = null;
      startY = event.global.y;
      startOffset = content.y;
    });
    this.on("globalpointermove", (event: FederatedPointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const delta = event.global.y - startY;
      if (Math.abs(delta) < TOUCH_MOVE_SLOP_PX && scrolledPointerId === null) return;
      scrolledPointerId = event.pointerId;
      event.preventDefault();
      scroll(startOffset + delta);
    });
    const finish = () => {
      pointerId = null;
    };
    this.on("pointerup", finish);
    this.on("pointerupoutside", finish);
    this.on("pointercancel", finish);
    this.on("pointertapcapture", (event: FederatedPointerEvent) => {
      if (event.pointerId !== scrolledPointerId) return;
      event.stopImmediatePropagation();
      scrolledPointerId = null;
    });
  }

  setCurrentTileX(x: number): void {
    if (this.currentTile) this.currentTile.x = x;
  }

  setCurrentTileRise(rise: number): void {
    if (this.currentTile) this.currentTile.scale.y = rise;
  }
}
