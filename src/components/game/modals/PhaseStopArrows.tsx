const SHAFT = 5;
const HEAD_LENGTH = 16;
const HEAD_HALF_WIDTH = 11;

export interface PhaseStopArrow {
  key: string;
  x: number;
  color: string;
}

interface PhaseStopArrowsProps {
  arrows: readonly PhaseStopArrow[];
  railY: number;
  tipY: number;
  railEnd?: number;
  mixedRailColor: string;
}

export function PhaseStopArrows({
  arrows,
  railY,
  tipY,
  railEnd,
  mixedRailColor,
}: PhaseStopArrowsProps) {
  if (arrows.length === 0) return null;
  const xs = arrows.map((arrow) => arrow.x);
  const colors = new Set(arrows.map((arrow) => arrow.color));
  const baseY = tipY - Math.sign(tipY - railY) * HEAD_LENGTH;
  return (
    <>
      <line
        x1={Math.min(...xs) - SHAFT / 2}
        x2={railEnd ?? Math.max(...xs) + SHAFT / 2}
        y1={railY}
        y2={railY}
        stroke={colors.size === 1 ? arrows[0]!.color : mixedRailColor}
        strokeWidth={SHAFT}
      />
      {arrows.map(({ key, x, color }) => (
        <g key={key}>
          <line x1={x} x2={x} y1={railY} y2={baseY} stroke={color} strokeWidth={SHAFT} />
          <polygon
            points={`${x},${tipY} ${x - HEAD_HALF_WIDTH},${baseY} ${x + HEAD_HALF_WIDTH},${baseY}`}
            fill={color}
          />
        </g>
      ))}
    </>
  );
}
