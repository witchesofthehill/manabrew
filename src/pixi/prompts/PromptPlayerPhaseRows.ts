import { Container, Graphics } from "pixi.js";
import { PHASE_BAR_ENTRIES } from "@/components/game/game.constants";
import { togglePhaseStops } from "@/components/game/game.utils";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { usePhaseStopStore } from "@/stores/usePhaseStopStore";
import { readableTextColor } from "@/themes/gameTheme";
import { getUiControlHeight, getUiFontSize } from "@/themes/typography";
import { PromptButton } from "./PromptButton";
import { promptText } from "./PromptLayerBase";
import type { PromptOverlaySpec } from "./prompt.types";

const GAP = 4;
const ROW_GAP = 8;
const NAME_INSET = 16;

interface PhaseStopPlayer {
  id: string;
  name: string;
  color: string;
  stops: ReadonlySet<string>;
}

export class PromptPlayerPhaseRows extends Container {
  readonly contentHeight: number;

  constructor(
    theme: Theme,
    spec: PromptOverlaySpec,
    players: readonly PhaseStopPlayer[],
    width: number,
  ) {
    super();
    const stops = usePhaseStopStore.getState();
    const cellHeight = getUiControlHeight();
    const columns = Math.min(
      PHASE_BAR_ENTRIES.length,
      Math.max(1, Math.floor((width + GAP) / (cellHeight + GAP))),
    );
    const cellWidth = (width - GAP * (columns - 1)) / columns;
    const phaseRows = Math.ceil(PHASE_BAR_ENTRIES.length / columns);
    const surface = theme.gameTheme.phaseStrip.background;
    const ink = readableTextColor(
      surface,
      theme.gameTheme.canvas.shadow,
      theme.gameTheme.textOnTinted,
    );
    let y = 0;
    for (const player of players) {
      const name = promptText(player.name, getUiFontSize("label"), ink, {
        weight: "700",
        width: width - NAME_INSET,
        truncate: true,
      });
      name.position.set(NAME_INSET, y);
      const dot = new Graphics()
        .circle(4, y + name.height / 2, 3)
        .fill({ color: hexToNum(player.color) });
      dot.eventMode = "none";
      this.addChild(dot, name);
      const buttonsY = y + name.height + ROW_GAP;
      const playerInk = readableTextColor(
        player.color,
        theme.gameTheme.canvas.shadow,
        theme.gameTheme.textOnTinted,
      );
      PHASE_BAR_ENTRIES.forEach((entry, index) => {
        const enabled = entry.steps.some((step) => player.stops.has(step));
        const current =
          player.id === spec.gameView.activePlayerId && entry.steps.includes(spec.gameView.step);
        const button = new PromptButton(theme, {
          label: entry.id === "combat" ? "COM" : entry.short,
          title: `${player.name}: ${entry.label}, ${enabled ? "stop" : "skip"}`,
          width: cellWidth,
          height: cellHeight,
          paddingX: 0,
          radius: 4,
          outline: true,
          backgroundColor: enabled ? player.color : surface,
          backgroundAlpha: 1,
          hoverBackgroundAlpha: 0.85,
          foreground: enabled ? playerInk : ink,
          borderColor: current ? spec.turnColor : player.color,
          borderAlpha: current ? 1 : 0,
          hoverBorderAlpha: 1,
          fontSize: getUiFontSize("meta"),
          fontWeight: "700",
          pressOffsetY: 0,
          onPress: () =>
            togglePhaseStops(entry.steps, player.stops, (step) => {
              if (player.id === spec.localPlayerId) stops.toggleSelfStop(step);
              else stops.toggleOpponentStop(player.id, step);
            }),
        });
        button.position.set(
          (index % columns) * (cellWidth + GAP),
          buttonsY + Math.floor(index / columns) * (cellHeight + GAP),
        );
        this.addChild(button);
      });
      y = buttonsY + phaseRows * (cellHeight + GAP) - GAP + ROW_GAP;
    }
    this.contentHeight = y - ROW_GAP;
  }
}
