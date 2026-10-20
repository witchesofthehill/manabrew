import { MANABREW_THEME, type ThemeColors, type GameThemeColorMap } from "@/themes";
import { filterGameThemeColorOverrides } from "@/themes/gameTheme";
import { BRAND_COLORS } from "@/themes/brand";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { APP_THEME_COLOR_LABELS } from "@/themes/themeMetadata";
import { Section, Subhead, Swatch, SwatchGrid } from "../kit";
function groupGameColors(colors: GameThemeColorMap): {
  name: string;
  entries: [string, string][];
}[] {
  const groups = new Map<string, [string, string][]>();
  for (const [key, value] of Object.entries(colors)) {
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
              className="rounded-full border px-2 py-0.5 text-[10px]"
              style={{
                background: g("selection"),
                borderColor: g("selection-border"),
                color: g("selection-foreground"),
              }}
            >
              Selected
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
function AppTokens({ colors, mode }: { colors: ThemeColors; mode: string }) {
  return (
    <div className="ds-app-token-mode space-y-1.5">
      <div className="font-mono text-[11px] text-muted-foreground">{mode}</div>
      <SwatchGrid>
        {(Object.entries(colors) as [keyof ThemeColors, string][]).map(([key, value]) => (
          <Swatch key={key} value={value} label={key} sub={APP_THEME_COLOR_LABELS[key]} />
        ))}
      </SwatchGrid>
    </div>
  );
}

function ThemeCard({ theme }: { theme: typeof MANABREW_THEME }) {
  return (
    <div className="ds-theme-card space-y-4 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-baseline gap-2">
        <h3 className="text-lg font-semibold tracking-tight">{theme.name}</h3>
      </div>

      <Subhead>App chrome</Subhead>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AppChrome colors={theme.light} mode="Light" />
        <AppChrome colors={theme.dark} mode="Dark" />
      </div>

      <Subhead>App tokens</Subhead>
      <div className="ds-app-token-modes grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AppTokens colors={theme.light} mode="Light" />
        <AppTokens colors={theme.dark} mode="Dark" />
      </div>

      <Subhead>Game tokens</Subhead>
      <div className="space-y-3">
        {groupGameColors(theme.gameColors).map((grp) => (
          <div key={grp.name} className="ds-color-group space-y-1.5">
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
export function ColorSection() {
  const appOverrides = usePreferencesStore((state) => state.appThemeColorOverrides);
  const gameOverrides = usePreferencesStore((state) => state.gameThemeColorOverrides);
  const personalName = usePreferencesStore((state) => state.personalThemeName);
  const resolvedTheme = {
    ...MANABREW_THEME,
    name: personalName ?? MANABREW_THEME.name,
    light: { ...MANABREW_THEME.light, ...appOverrides.light },
    dark: { ...MANABREW_THEME.dark, ...appOverrides.dark },
    gameColors: { ...MANABREW_THEME.gameColors, ...filterGameThemeColorOverrides(gameOverrides) },
  };
  return (
    <Section
      id="color"
      title="Color"
      intro="Your current theme, including personal color overrides. Light and dark app colors are shown together."
    >
      <div className="space-y-4">
        <Subhead>Manabrew brand families</Subhead>
        <p className="text-sm text-muted-foreground">
          Ember actions, purple mana and selection, and sparse sage details. These families define
          one identity, not selectable themes.
        </p>
        {Object.entries(BRAND_COLORS).map(([family, shades]) => (
          <div key={family} className="ds-color-group space-y-2">
            <h3 className="text-sm font-semibold capitalize">{family}</h3>
            <SwatchGrid>
              {Object.entries(shades).map(([shade, value]) => (
                <Swatch key={shade} label={`${family}.${shade}`} value={value} />
              ))}
            </SwatchGrid>
          </div>
        ))}
      </div>
      <ThemeCard theme={resolvedTheme} />
    </Section>
  );
}
