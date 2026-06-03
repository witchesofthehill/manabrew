import { cn } from "@/lib/utils";

interface DieShapeProps {
  sides: number;
  value: number;
  settled: boolean;
  rolling: boolean;
  /** CSS colour used for the silhouette and the settled fill. Falls back to
   *  the theme `--primary` when omitted. */
  accentColor?: string;
  className?: string;
}

const VIEW_BOX = 100;
const CENTER = VIEW_BOX / 2;
const RADIUS = 46;

/**
 * Visual silhouette per die type. Vertex count follows physical-die
 * conventions: d4 triangle, d6 square, d8 hexagon (octahedron projection),
 * d10 pentagonal kite (drawn as pentagon), d12 hexagon, d20 octagon
 * (icosahedron projection), d100 dodecagon (near-circle with %).
 */
const VERTICES_FOR: Record<number, number> = {
  4: 3,
  6: 4,
  8: 6,
  10: 5,
  12: 6,
  20: 8,
  100: 12,
};

function polygonPath(vertexCount: number, rotationDeg: number): string {
  const points: string[] = [];
  const angleOffset = (rotationDeg * Math.PI) / 180;
  for (let i = 0; i < vertexCount; i++) {
    const angle = angleOffset + (i * 2 * Math.PI) / vertexCount;
    const x = CENTER + RADIUS * Math.cos(angle);
    const y = CENTER + RADIUS * Math.sin(angle);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

export function DieShape({
  sides,
  value,
  settled,
  rolling,
  accentColor,
  className,
}: DieShapeProps) {
  const vertexCount = VERTICES_FOR[sides] ?? 6;
  // Point-up orientation for odd-vertex shapes (triangle, pentagon);
  // flat-top for even-vertex shapes (square, hexagon, octagon).
  const rotation = vertexCount % 2 === 1 ? -90 : -90 + 180 / vertexCount;
  const points = polygonPath(vertexCount, rotation);
  const label = sides === 100 ? `${value}%` : `${value}`;
  const stroke = accentColor ?? "var(--primary)";
  return (
    <div
      className={cn(
        "grid place-items-center",
        rolling && "animate-companion-die-tumble",
        className,
      )}
    >
      <svg viewBox={`0 0 ${VIEW_BOX} ${VIEW_BOX}`} className="size-32 drop-shadow-lg" aria-hidden>
        <polygon
          points={points}
          className="transition-colors"
          stroke={settled ? stroke : "var(--border)"}
          strokeWidth={2.5}
          fill={settled ? stroke : "var(--muted)"}
          fillOpacity={settled ? 0.18 : 0.4}
        />
        <text
          x={CENTER}
          y={CENTER}
          textAnchor="middle"
          dominantBaseline="central"
          className={cn(
            "font-black tabular-nums",
            settled ? "text-foreground" : "text-muted-foreground",
          )}
          fill="currentColor"
          style={{ fontSize: sides === 100 ? 26 : 36 }}
        >
          {label}
        </text>
      </svg>
    </div>
  );
}
