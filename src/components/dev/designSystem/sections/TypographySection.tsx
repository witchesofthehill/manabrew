import { cn } from "@/lib/utils";
import { Section, Subhead, Panel } from "../kit";
import { FONTS, GAME_FONT_SIZES } from "../designSystem.data";

const SCALE: { cls: string; label: string }[] = [
  { cls: "text-5xl font-light tracking-[0.08em] font-serif", label: "Display / hero" },
  { cls: "text-3xl font-light tracking-tight font-serif", label: "Section heading" },
  { cls: "text-xl font-semibold", label: "Panel title" },
  { cls: "text-base font-semibold", label: "Modal title" },
  { cls: "text-sm", label: "Body" },
  { cls: "text-xs text-muted-foreground", label: "Caption / subtitle" },
  { cls: "text-[10px] uppercase tracking-[0.08em] text-muted-foreground", label: "Label" },
];

export function TypographySection() {
  return (
    <Section
      id="typography"
      title="Typography"
      intro="Three self-hosted families (@fontsource). rem drives chrome so text scales up on ≥2000px displays; px is reserved for card art."
    >
      <div className="grid gap-3 md:grid-cols-3">
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
