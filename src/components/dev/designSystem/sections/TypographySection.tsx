import { cn } from "@/lib/utils";
import { Section, Subhead, Panel } from "../kit";
import { FONTS, GAME_FONT_SIZES } from "../designSystem.data";
const SCALE: {
  cls: string;
  label: string;
  sizes?: string;
  sample?: string;
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
    cls: "text-ui-body font-semibold",
    label: `Modal title`,
  },
  {
    cls: "text-ui-body",
    label: `Body`,
    sizes: "Fine 16px · compact touch 16px · wide touch 20px",
    sample:
      "Choose a deck to start a game. This body copy wraps at narrow widths without shrinking.",
  },
  {
    cls: "text-ui-label font-medium",
    label: `Label`,
    sizes: "Fine 14px · compact touch 16px · wide touch 20px",
    sample: "Include cards from every available set in this collection",
  },
  {
    cls: "text-ui-meta text-muted-foreground",
    label: `Meta`,
    sizes: "Fine 12px · compact touch 14px · wide touch 18px",
    sample: "60 cards · Updated today · Ready to play",
  },
  {
    cls: "text-ui-caption text-muted-foreground",
    label: `Caption`,
    sizes: "Fine 12px · compact touch 12px · wide touch 14px · nonessential only",
    sample: "An optional note about this example.",
  },
  {
    cls: "text-ui-input",
    label: `Input`,
    sizes: "Fine 14px · compact touch 16px · wide touch 20px",
    sample: "Search by card name, type, or rules text",
  },
];
export function TypographySection() {
  return (
    <Section
      id="typography"
      title={`Typography`}
      intro="Two self-hosted families. Alegreya Sans Bold supplies display titles; Source Sans 3 supplies body, controls and game text. Touch values apply whenever any pointer is coarse, including hybrid devices. The wide-touch tier starts at 48rem of viewport width. Card art keeps its native printing fonts."
    >
      <div className="grid gap-3 md:grid-cols-2">
        {FONTS.map((f) => (
          <Panel key={f.role} className="space-y-2">
            <Subhead>{f.role}</Subhead>
            <div className={cn("break-words text-2xl", f.cls)}>{f.stack}</div>
            <div className={cn("text-ui-body text-muted-foreground", f.cls)}>
              The quick brown fox jumps
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 font-mono text-ui-meta text-muted-foreground">
              <span>{f.cls}</span>
              <span>· {f.weights}</span>
            </div>
            <p className="text-ui-body text-muted-foreground">{f.use}</p>
          </Panel>
        ))}
      </div>

      <Subhead>Type scale</Subhead>
      <Panel className="space-y-4">
        {SCALE.map((s) => (
          <div key={s.label} className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <div className="w-full shrink-0 space-y-1 sm:w-48">
              <p className="font-mono text-ui-label text-muted-foreground">{s.label}</p>
              {s.sizes && <p className="text-ui-meta text-muted-foreground">{s.sizes}</p>}
            </div>
            <span className={cn("min-w-0 max-w-lg break-words", s.cls)}>
              {s.sample ?? "Manabrew"}
            </span>
          </div>
        ))}
      </Panel>

      <Subhead>Game counters</Subhead>
      <Panel className="space-y-2">
        <p className="font-game text-2xl font-semibold tabular-nums lining-nums">
          20 · 11 · 08 · 3/4 · 09:42
        </p>
        <p className="text-ui-body text-muted-foreground">
          Lining tabular numerals keep counters and timers steady. Body prose uses proportional
          numerals.
        </p>
      </Panel>

      <Subhead>Game font-size tokens</Subhead>
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-ui-label">
            <thead className="text-ui-label uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4 font-semibold">Token</th>
                <th className="pb-2 pr-4 font-semibold">Value</th>
                <th className="pb-2 font-semibold">Usage</th>
              </tr>
            </thead>
            <tbody>
              {GAME_FONT_SIZES.map((t) => (
                <tr key={t.token} className="border-t border-border">
                  <td className="py-2 pr-4 font-mono text-ui-label">{t.token}</td>
                  <td className="py-2 pr-4 font-mono text-ui-meta text-muted-foreground">
                    {t.value}
                  </td>
                  <td className="py-2 text-ui-body text-muted-foreground">{t.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Section>
  );
}
