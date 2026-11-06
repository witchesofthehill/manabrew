import { Container, Graphics, Rectangle, type FederatedPointerEvent } from "pixi.js";
import { PHASE_BAR_ENTRIES } from "@/components/game/game.constants";
import { togglePhaseStops } from "@/components/game/game.utils";
import type { Theme } from "@/hooks/useTheme";
import { TOUCH_MOVE_SLOP_PX } from "@/lib/responsive";
import { stripUsernameTag } from "@/lib/username";
import { DEFAULT_OPPONENT_STOPS, usePhaseStopStore } from "@/stores/usePhaseStopStore";
import { readableTextColor } from "@/themes/gameTheme";
import {
  getUiControlFloor,
  getUiControlHeight,
  getUiFontSize,
  isTouchUi,
} from "@/themes/typography";
import { hexToNum } from "@/pixi/colorUtils";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
import { PromptButton } from "./PromptButton";
import { promptText } from "./PromptLayerBase";
import type { PromptOverlaySpec } from "./prompt.types";

const GAP = 4;
const ROW_GAP = 8;
const INDICATOR_HEIGHT = 4;
const INDICATOR_MARGIN = 3;
const INDICATOR_HIT_HEIGHT = 12;
const INDICATOR_GHOST_ALPHA = 0.35;
const HOVER_SCALE = 1.3;
const HOVER_SECONDS = 0.14;
const PAD = 12;

export class PromptPhaseControls extends Container {
  readonly contentHeight: number;

  constructor(theme: Theme, spec: PromptOverlaySpec, width: number, maxHeight: number) {
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
    const availableWidth = width - PAD * 2;
    const cellHeight = getUiControlHeight();
    const indicatorHeight = Math.max(INDICATOR_HIT_HEIGHT, getUiControlFloor());
    const rowHeight = cellHeight + indicatorHeight * (opponents.length > 0 ? 2 : 1);
    const surface = theme.gameTheme.phaseStrip.background;
    const ink = readableTextColor(
      surface,
      theme.gameTheme.canvas.shadow,
      theme.gameTheme.textOnTinted,
    );
    const labels = PHASE_BAR_ENTRIES.map((entry) =>
      promptText(entry.id === "combat" ? "COM" : entry.short, getUiFontSize("meta"), ink, {
        weight: "700",
      }),
    );
    const minCellWidth = Math.max(
      cellHeight,
      opponents.length * getUiControlFloor() + Math.max(0, opponents.length - 1) * GAP,
    );
    const columns = Math.min(
      PHASE_BAR_ENTRIES.length,
      Math.max(1, Math.floor((availableWidth + GAP) / (minCellWidth + GAP))),
    );
    const phaseWidth = (availableWidth - GAP * (columns - 1)) / columns;
    PHASE_BAR_ENTRIES.forEach((entry, index) => {
      const label = labels[index];
      const group = new Container();
      group.position.set(
        PAD + (index % columns) * (phaseWidth + GAP),
        PAD + Math.floor(index / columns) * (rowHeight + ROW_GAP),
      );
      group.eventMode = "static";
      const hitArea = new Rectangle(0, 0, phaseWidth, rowHeight);
      group.hitArea = hitArea;
      const phaseY = opponents.length > 0 ? indicatorHeight : 0;
      const current = entry.steps.includes(spec.gameView.step);
      const background = new Graphics()
        .roundRect(0, phaseY, phaseWidth, cellHeight, 4)
        .fill({ color: hexToNum(surface) });
      if (current) background.stroke({ color: hexToNum(spec.turnColor), width: 2, alignment: 1 });
      background.eventMode = "none";
      label.anchor.set(0.5);
      label.position.set(phaseWidth / 2, phaseY + cellHeight / 2);
      group.addChild(background, label);
      const ghosts: Graphics[] = [];
      const opponentControls = new Container();
      opponentControls.pivot.set(phaseWidth / 2, indicatorHeight);
      opponentControls.position.set(phaseWidth / 2, indicatorHeight);
      const opponentScale = opponentControls.scale;
      let hovered = false;
      const setHovered = (value: boolean) => {
        if (hovered === value || opponents.length === 0) return;
        hovered = value;
        const x = value ? Math.min(HOVER_SCALE, 1 + (PAD * 2) / phaseWidth) : 1;
        const y = value ? 1 + PAD / indicatorHeight : 1;
        const growX = (phaseWidth * (x - 1)) / 2;
        const growY = indicatorHeight * (y - 1);
        hitArea.x = -growX;
        hitArea.y = -growY;
        hitArea.width = phaseWidth + growX * 2;
        hitArea.height = rowHeight + growY;
        if (value) content.setChildIndex(group, content.children.length - 1);
        gsap.killTweensOf(opponentScale);
        if (!animationsEnabled()) {
          opponentScale.set(x, y);
          return;
        }
        gsap.to(opponentScale, { x, y, duration: HOVER_SECONDS, ease: "power2.out" });
      };
      group.on("destroyed", () => gsap.killTweensOf(opponentScale));
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
          tooltip: true,
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
        const marker = new Graphics()
          .roundRect(0, 0, markerWidth, INDICATOR_HEIGHT, INDICATOR_HEIGHT / 2)
          .fill({ color: hexToNum(player.color) });
        marker.position.set(
          (self ? 0 : (playerIndex - 1) * (markerWidth + GAP)) - button.x,
          markerY,
        );
        marker.eventMode = "none";
        marker.alpha = enabled
          ? self && spec.gameView.activePlayerId !== spec.localPlayerId
            ? 0.55
            : 1
          : isTouchUi()
            ? INDICATOR_GHOST_ALPHA
            : 0;
        if (!enabled) ghosts.push(marker);
        const markerBorder = new Graphics()
          .roundRect(0, 0, markerWidth, INDICATOR_HEIGHT, INDICATOR_HEIGHT / 2)
          .stroke({
            color: hexToNum(
              readableTextColor(
                player.color,
                theme.gameTheme.canvas.shadow,
                theme.gameTheme.textOnTinted,
              ),
            ),
            width: 1,
            alignment: 1,
          });
        markerBorder.position.copyFrom(marker.position);
        markerBorder.eventMode = "none";
        markerBorder.visible = false;
        let pointerOver = false;
        let focused = false;
        const syncMarker = () => {
          const active = pointerOver || focused;
          markerBorder.visible = active;
          if (self) {
            marker.scale.y = markerBorder.scale.y = active ? 1.5 : 1;
            marker.y = markerBorder.y = active ? markerY - 1 : markerY;
          }
        };
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
        button.addChild(marker, markerBorder);
        (self ? group : opponentControls).addChild(button);
      });
      group.addChild(opponentControls);
      group.on("pointerenter", (event: FederatedPointerEvent) => {
        for (const ghost of ghosts) ghost.alpha = INDICATOR_GHOST_ALPHA;
        if (event.pointerType !== "touch") setHovered(true);
      });
      group.on("pointerleave", () => {
        for (const ghost of ghosts) ghost.alpha = isTouchUi() ? INDICATOR_GHOST_ALPHA : 0;
        setHovered(false);
      });
      content.addChild(group);
    });
    const fullHeight =
      PAD * 2 + Math.ceil(PHASE_BAR_ENTRIES.length / columns) * (rowHeight + ROW_GAP) - ROW_GAP;
    this.contentHeight = Math.min(fullHeight, Math.max(cellHeight, maxHeight));
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
}
