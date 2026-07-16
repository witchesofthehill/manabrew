import { Section, Subhead, Panel } from "../kit";
import { RADIUS_TOKENS, CARD_SIZES } from "../designSystem.data";

const SPACING = [1, 2, 3, 4, 6, 8, 12] as const;

export function SpacingSection() {
  return (
    <Section
      id="spacing"
      title="Spacing & radius"
      intro="Tailwind's default spacing scale (rem-based, so it scales on large displays). Radius derives from a single --radius base. Card sizing is fixed px."
    >
      <Subhead>Radius</Subhead>
      <Panel className="flex flex-wrap gap-4">
        {RADIUS_TOKENS.map((r) => (
          <div key={r.token} className="flex flex-col items-center gap-2">
            <div
              className="h-16 w-16 border-2 border-primary bg-primary/10"
              style={{ borderRadius: `var(${r.token.split(" ")[0]})` }}
            />
            <div className="text-center">
              <div className="font-mono text-[11px]">{r.cls}</div>
              <div className="font-mono text-[10px] text-muted-foreground">{r.value}</div>
            </div>
          </div>
        ))}
      </Panel>

      <Subhead>Spacing scale</Subhead>
      <Panel className="space-y-2">
        {SPACING.map((n) => (
          <div key={n} className="flex items-center gap-3">
            <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">p-{n}</span>
            <div className="h-4 bg-primary" style={{ width: `${n * 0.25}rem` }} />
            <span className="font-mono text-[10px] text-muted-foreground">{n * 0.25}rem</span>
          </div>
        ))}
      </Panel>

      <Subhead>Card sizes (px)</Subhead>
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4 font-semibold">Surface</th>
                <th className="pb-2 pr-4 font-semibold">Dimensions</th>
                <th className="pb-2 font-semibold">Constant</th>
              </tr>
            </thead>
            <tbody>
              {CARD_SIZES.map((c) => (
                <tr key={c.token} className="border-t border-border">
                  <td className="py-2 pr-4 text-xs">{c.token}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{c.dims}</td>
                  <td className="py-2 font-mono text-xs text-muted-foreground">{c.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Section>
  );
}
