import { useMemo } from "react";
import { THEME_PRESETS } from "@/themes";
import { resolveGameThemeColors, flattenGameThemeToCssVars } from "@/themes/gameTheme";

export type PreviewMode = "light" | "dark";

interface PresetScopeProps {
  presetId: string;
  mode: PreviewMode;
  className?: string;
  children: React.ReactNode;
}

// Light/dark in this app is a pure CSS-variable swap (no class-based `dark:`
// variant), so injecting a preset's app + game vars inline on a container
// fully re-skins every token-driven descendant without touching :root.
// Pixi surfaces read the theme imperatively and are unaffected — DOM only.
function scopedThemeVars(presetId: string, mode: PreviewMode): React.CSSProperties {
  const preset = THEME_PRESETS.find((p) => p.id === presetId) ?? THEME_PRESETS[0]!;
  const vars: Record<string, string> = { colorScheme: mode };
  for (const [key, value] of Object.entries(preset[mode])) vars[`--${key}`] = value;
  for (const [key, value] of Object.entries(
    flattenGameThemeToCssVars(resolveGameThemeColors({}, presetId)),
  )) {
    vars[key] = value;
  }
  return vars as React.CSSProperties;
}

export function PresetScope({ presetId, mode, className, children }: PresetScopeProps) {
  const style = useMemo(() => scopedThemeVars(presetId, mode), [presetId, mode]);
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}
