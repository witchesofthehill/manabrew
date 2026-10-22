import { ManaBrewLogo } from "@/components/layout/ManaBrewLogo";
import { Section, Subhead, Panel } from "../kit";
import { ASSETS, DATA_ASSETS } from "../designSystem.data";
export function AssetsSection() {
  return (
    <Section
      id="assets"
      title={`Assets`}
      intro="Brand imagery, favicons/PWA icons, and the static data files the app ships. The static logo uses complete light and dark SVG groups from images/brand/logos/interactive/. URL-served images and generated icons live in public/."
    >
      <Subhead>Approved logo variants</Subhead>
      <Panel className="space-y-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-6">
            <div className="space-y-2">
              <ManaBrewLogo height={72} />
              <p className="font-mono text-[11px] text-muted-foreground">Horizontal · 72px high</p>
            </div>
            <div className="space-y-2">
              <ManaBrewLogo height={56} />
              <p className="font-mono text-[11px] text-muted-foreground">Header · 56px high</p>
            </div>
          </div>
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            Static sprite: interactive/manabrew-logo.svg · Dark 1080 × 400 · Light 1450 × 400
          </p>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-6">
            <div className="space-y-2">
              <ManaBrewLogo variant="symbol" height={48} />
              <p className="font-mono text-[11px] text-muted-foreground">Symbol · 48px</p>
            </div>
            <div className="space-y-2">
              <ManaBrewLogo variant="symbol" height={36} />
              <p className="font-mono text-[11px] text-muted-foreground">Compact header · 36px</p>
            </div>
            <div className="space-y-2">
              <ManaBrewLogo variant="symbol" height={32} />
              <p className="font-mono text-[11px] text-muted-foreground">Small symbol · 32px</p>
            </div>
          </div>
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            Brewy-only symbol · 512 × 512 · Favicons and native icons use dedicated symbol exports
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Dark mode uses the approved white Brewy and ember wordmark; light mode uses black Brewy,
          an orange wordmark, and lavender, ember, and sage bubbles, including theme previews. Each
          mode keeps its approved geometry. ManaBrewLogo renders one complete static group from the
          shared sprite. Preserve the source colors, aspect ratio, and transparent background.
        </p>
      </Panel>

      <Subhead>Images & icons</Subhead>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {ASSETS.map((a) => (
          <div
            key={a.file}
            className="ds-asset overflow-hidden rounded-lg border border-border bg-card"
          >
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

      <Subhead>Static data files</Subhead>
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
