import { PHASE_BAR_ENTRIES } from "@/components/game/game.constants";
import { useTheme } from "@/hooks/useTheme";
import { PhaseStopArrows } from "./PhaseStopArrows";
import {
  BOTTOM_MARKER_Y,
  labelX,
  MARKER_HEIGHT,
  stopArrows,
  TOP_MARKER_Y,
} from "./phaseStopCompact.utils";
import {
  hasStop,
  phaseList,
  STOP_DIAGRAM_TEXT,
  STOP_DIAGRAM_TITLE,
  type PhaseStopPlayer,
} from "./phaseStopDiagram.utils";

const TOP_RAIL_Y = 103;
const BOTTOM_RAIL_Y = 291;
const ARROW_CLEARANCE = 7;
const BOTTOM_TIP_Y = BOTTOM_MARKER_Y + MARKER_HEIGHT + ARROW_CLEARANCE;

function opponentLabel(opponentCount: number, anyStop: boolean, stopList: string) {
  if (opponentCount === 1)
    return {
      title: "Line above: opponent's turn",
      body: anyStop ? `You will stop at ${stopList}.` : "You will not stop on the opponent's turn.",
    };
  return {
    title: "Lines above: opponents' turns",
    body: anyStop
      ? "One color for each opponent. You stop at this step on their turn."
      : "You will not stop on an opponent's turn.",
  };
}

function Label({ x, y, title, body }: { x: number; y: number; title: string; body: string }) {
  return (
    <>
      <text x={x} y={y} textAnchor="middle" className={STOP_DIAGRAM_TITLE}>
        {title}
      </text>
      <text x={x} y={y + 36} textAnchor="middle" className={STOP_DIAGRAM_TEXT}>
        {body}
      </text>
    </>
  );
}

export function PhaseStopCompactAnnotations({ players }: { players: readonly PhaseStopPlayer[] }) {
  const { appTheme } = useTheme();
  const mixedRailColor = appTheme["muted-foreground"];
  const self = players[0]!;
  const opponents = players.slice(1);
  const selfEntries = PHASE_BAR_ENTRIES.filter((entry) => hasStop(entry, self));
  const opponentEntries = PHASE_BAR_ENTRIES.filter((entry) =>
    opponents.some((player) => hasStop(entry, player)),
  );
  const selfArrows = stopArrows(players, true);
  const opponentArrows = stopArrows(players, false);
  return (
    <>
      {opponents.length > 0 && (
        <>
          <PhaseStopArrows
            arrows={opponentArrows}
            railY={TOP_RAIL_Y}
            tipY={TOP_MARKER_Y - ARROW_CLEARANCE}
            mixedRailColor={mixedRailColor}
          />
          <Label
            x={labelX(opponentArrows)}
            y={46}
            {...opponentLabel(
              opponents.length,
              opponentArrows.length > 0,
              phaseList(opponentEntries),
            )}
          />
        </>
      )}
      <PhaseStopArrows
        arrows={selfArrows}
        railY={BOTTOM_RAIL_Y}
        tipY={BOTTOM_TIP_Y}
        mixedRailColor={mixedRailColor}
      />
      <Label
        x={labelX(selfArrows)}
        y={335}
        title="Line below: your turn"
        body={
          selfEntries.length > 0
            ? `You will stop at ${phaseList(selfEntries)}.`
            : "You will not stop on your turn."
        }
      />
    </>
  );
}
