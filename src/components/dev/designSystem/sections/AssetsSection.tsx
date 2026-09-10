import { ManaBrewLogo } from "@/components/layout/ManaBrewLogo";
import { Section, Subhead, Panel } from "../kit";
import { ASSETS, DATA_ASSETS } from "../designSystem.data";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export function AssetsSection() {
  return (
    <Section
      id="assets"
      title={i18n._(msg`Assets`)}
      intro="Brand imagery, favicons/PWA icons, and the static data files the app ships. Image assets live in public/ (URL-served) except the logo, which is a bundled src/assets import."
    >
      <Subhead>
        <Trans>Brand mark</Trans>
      </Subhead>
      <Panel className="flex flex-wrap items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <ManaBrewLogo size={96} className="rounded-xl" />
          <span className="font-mono text-[11px] text-muted-foreground">
            <Trans>96px</Trans>
          </span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <ManaBrewLogo size={48} className="rounded-lg" />
          <span className="font-mono text-[11px] text-muted-foreground">
            <Trans>48px</Trans>
          </span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <ManaBrewLogo size={28} className="rounded-lg" />
          <span className="font-mono text-[11px] text-muted-foreground">
            <Trans>28px</Trans>
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          <Trans>src/assets/manaBrew.png</Trans>
        </span>
      </Panel>

      <Subhead>
        <Trans>Images & icons</Trans>
      </Subhead>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {ASSETS.map((a) => (
          <div key={a.file} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex h-28 items-center justify-center bg-muted/40 p-3">
              {a.preview && (
                <img
                  src={a.preview}
                  alt={a.file}
                  className="max-h-full max-w-full object-contain"
                  loading="lazy"
                />
              )}
            </div>
            <div className="space-y-0.5 p-2">
              <div className="text-[11px] font-semibold">{a.kind}</div>
              <div className="truncate font-mono text-[10px] text-muted-foreground" title={a.file}>
                {a.file}
              </div>
              <div className="text-[10px] text-muted-foreground">{a.use}</div>
            </div>
          </div>
        ))}
      </div>

      <Subhead>
        <Trans>Static data files</Trans>
      </Subhead>
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <tbody>
              {DATA_ASSETS.map((d) => (
                <tr key={d.file} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{d.file}</td>
                  <td className="py-2 text-xs text-muted-foreground">{d.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Section>
  );
}
