import { THEME_PRESETS } from "@/themes";
import type { ThemePreset, ThemeColors } from "@/themes";
import { Section, Subhead, Swatch, SwatchGrid } from "../kit";

function groupGameColors(preset: ThemePreset): { name: string; entries: [string, string][] }[] {
  const groups = new Map<string, [string, string][]>();
  for (const [key, value] of Object.entries(preset.gameColors)) {
    const dot = key.indexOf(".");
    const group = dot === -1 ? "core" : key.slice(0, dot);
    const label = dot === -1 ? key : key.slice(dot + 1);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push([label, value]);
  }
  return [...groups.entries()].map(([name, entries]) => ({ name, entries }));
}

function AppChrome({ colors, mode }: { colors: ThemeColors; mode: string }) {
  const g = (k: keyof ThemeColors) => colors[k];
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {mode}
      </div>
      <div style={{ background: g("background") }} className="p-3">
        <div
          className="flex flex-col gap-2 rounded-lg border p-3"
          style={{ background: g("card"), borderColor: g("border"), color: g("card-foreground") }}
        >
          <div className="text-sm font-semibold">Card surface</div>
          <div className="text-xs" style={{ color: g("muted-foreground") }}>
            Muted secondary text
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span
              className="rounded px-2 py-1 text-[11px] font-semibold"
              style={{ background: g("primary"), color: g("primary-foreground") }}
            >
              Primary
            </span>
            <span
              className="rounded px-2 py-1 text-[11px] font-semibold"
              style={{ background: g("secondary"), color: g("secondary-foreground") }}
            >
              Secondary
            </span>
            <span
              className="rounded px-2 py-1 text-[11px] font-semibold"
              style={{ background: g("destructive"), color: g("destructive-foreground") }}
            >
              Delete
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span
              className="rounded-full border px-2 py-0.5 text-[10px]"
              style={{ borderColor: g("commander"), color: g("commander") }}
            >
              Commander
            </span>
            <span
              className="rounded-full border px-2 py-0.5 text-[10px]"
              style={{ borderColor: g("warning"), color: g("warning") }}
            >
              Warning
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px]"
              style={{ background: g("selection"), color: g("selection-foreground") }}
            >
              Selected
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetCard({ preset }: { preset: ThemePreset }) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-baseline gap-2">
        <h3 className="text-lg font-semibold tracking-tight">{preset.name}</h3>
        <span className="font-mono text-[11px] text-muted-foreground">#{preset.id}</span>
      </div>
      <p className="text-xs text-muted-foreground">{preset.description}</p>

      <Subhead>App chrome</Subhead>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AppChrome colors={preset.light} mode="Light" />
        <AppChrome colors={preset.dark} mode="Dark" />
      </div>

      <Subhead>Game tokens</Subhead>
      <div className="space-y-3">
        {groupGameColors(preset).map((grp) => (
          <div key={grp.name} className="space-y-1.5">
            <div className="font-mono text-[11px] text-muted-foreground">{grp.name}</div>
            <SwatchGrid>
              {grp.entries.map(([label, value]) => (
                <Swatch key={label} value={value} label={label} />
              ))}
            </SwatchGrid>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ColorSection({ presetId }: { presetId: string }) {
  const preset = THEME_PRESETS.find((p) => p.id === presetId) ?? THEME_PRESETS[0]!;
  return (
    <Section
      id="color"
      title="Color"
      intro={`The active theme — “${preset.name}”. Switch it from the selector at the top right to recolor the whole app and this page. 24 app-chrome tokens (light + dark) plus ~90 semantic game-surface tokens, straight from src/themes/*.`}
    >
      <PresetCard preset={preset} />
    </Section>
  );
}
