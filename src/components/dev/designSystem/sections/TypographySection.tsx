import { cn } from "@/lib/utils";
import { Section, Subhead, Panel } from "../kit";
import { FONTS, GAME_FONT_SIZES } from "../designSystem.data";
const SCALE: {
  cls: string;
  label: string;
}[] = [
  {
    cls: "text-5xl font-bold tracking-tight font-serif",
    label: `Display / hero`,
  },
  {
    cls: "text-3xl font-semibold tracking-tight font-serif",
    label: `Section heading`,
  },
  {
    cls: "text-xl font-semibold",
    label: `Panel title`,
  },
  {
    cls: "text-base font-semibold",
    label: `Modal title`,
  },
  {
    cls: "text-sm",
    label: `Body`,
  },
  {
    cls: "text-xs text-muted-foreground",
    label: `Caption / subtitle`,
  },
  {
    cls: "text-[10px] uppercase tracking-[0.08em] text-muted-foreground",
    label: `Label`,
  },
];
export function TypographySection() {
  return (
    <Section
      id="typography"
      title={`Typography`}
      intro="Two self-hosted families. Alegreya Sans Bold supplies display titles; Source Sans 3 supplies body, controls and game text. rem scales chrome on large displays; card art keeps its native printing fonts."
    >
      <div className="grid gap-3 md:grid-cols-2">
        {FONTS.map((f) => (
          <Panel key={f.role} className="space-y-2">
            <Subhead>{f.role}</Subhead>
            <div className={cn("text-2xl", f.cls)}>{f.stack}</div>
            <div className={cn("text-sm text-muted-foreground", f.cls)}>
              The quick brown fox jumps
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 font-mono text-[11px] text-muted-foreground">
              <span>{f.cls}</span>
              <span>· {f.weights}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{f.use}</p>
          </Panel>
        ))}
      </div>

      <Subhead>Type scale</Subhead>
      <Panel className="space-y-4">
        {SCALE.map((s) => (
          <div key={s.label} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="w-40 shrink-0 font-mono text-[11px] text-muted-foreground">
              {s.label}
            </span>
            <span className={s.cls}>Manabrew</span>
          </div>
        ))}
      </Panel>

      <Subhead>Game counters</Subhead>
      <Panel className="space-y-2">
        <p className="font-game text-2xl font-semibold tabular-nums lining-nums">
          20 · 11 · 08 · 3/4 · 09:42
        </p>
        <p className="text-xs text-muted-foreground">
          Lining tabular numerals keep counters and timers steady. Body prose uses proportional
          numerals.
        </p>
      </Panel>

      <Subhead>Game font-size tokens</Subhead>
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4 font-semibold">Token</th>
                <th className="pb-2 pr-4 font-semibold">Value</th>
                <th className="pb-2 font-semibold">Usage</th>
              </tr>
            </thead>
            <tbody>
              {GAME_FONT_SIZES.map((t) => (
                <tr key={t.token} className="border-t border-border">
                  <td className="py-2 pr-4 font-mono text-xs">{t.token}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{t.value}</td>
                  <td className="py-2 text-xs text-muted-foreground">{t.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Section>
  );
}
