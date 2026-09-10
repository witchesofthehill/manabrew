import { cn } from "@/lib/utils";
import { Section, Subhead, Panel } from "../kit";
import { FONTS, GAME_FONT_SIZES } from "../designSystem.data";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
const SCALE: {
  cls: string;
  label: string;
}[] = [
  {
    cls: "text-5xl font-light tracking-[0.08em] font-serif",
    get label() {
      return i18n._(msg`Display / hero`);
    },
  },
  {
    cls: "text-3xl font-light tracking-tight font-serif",
    get label() {
      return i18n._(msg`Section heading`);
    },
  },
  {
    cls: "text-xl font-semibold",
    get label() {
      return i18n._(msg`Panel title`);
    },
  },
  {
    cls: "text-base font-semibold",
    get label() {
      return i18n._(msg`Modal title`);
    },
  },
  {
    cls: "text-sm",
    get label() {
      return i18n._(msg`Body`);
    },
  },
  {
    cls: "text-xs text-muted-foreground",
    get label() {
      return i18n._(msg`Caption / subtitle`);
    },
  },
  {
    cls: "text-[10px] uppercase tracking-[0.08em] text-muted-foreground",
    get label() {
      return i18n._(msg`Label`);
    },
  },
];
export function TypographySection() {
  return (
    <Section
      id="typography"
      title={i18n._(msg`Typography`)}
      intro="Three self-hosted families (@fontsource). rem drives chrome so text scales up on ≥2000px displays; px is reserved for card art."
    >
      <div className="grid gap-3 md:grid-cols-3">
        {FONTS.map((f) => (
          <Panel key={f.role} className="space-y-2">
            <Subhead>{f.role}</Subhead>
            <div className={cn("text-2xl", f.cls)}>{f.stack}</div>
            <div className={cn("text-sm text-muted-foreground", f.cls)}>
              <Trans>The quick brown fox jumps</Trans>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 font-mono text-[11px] text-muted-foreground">
              <span>{f.cls}</span>
              <span>· {f.weights}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{f.use}</p>
          </Panel>
        ))}
      </div>

      <Subhead>
        <Trans>Type scale</Trans>
      </Subhead>
      <Panel className="space-y-4">
        {SCALE.map((s) => (
          <div key={s.label} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="w-40 shrink-0 font-mono text-[11px] text-muted-foreground">
              {s.label}
            </span>
            <span className={s.cls}>
              <Trans>Manabrew</Trans>
            </span>
          </div>
        ))}
      </Panel>

      <Subhead>
        <Trans>Game font-size tokens</Trans>
      </Subhead>
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4 font-semibold">
                  <Trans>Token</Trans>
                </th>
                <th className="pb-2 pr-4 font-semibold">
                  <Trans>Value</Trans>
                </th>
                <th className="pb-2 font-semibold">
                  <Trans>Usage</Trans>
                </th>
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
