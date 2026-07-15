import { useTheme as useColorMode } from "next-themes";
import { THEME_PRESETS } from "@/themes";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { cn } from "@/lib/utils";
import { SECTIONS } from "@/components/dev/designSystem/designSystem.data";
import { BrandSection } from "@/components/dev/designSystem/sections/BrandSection";
import { ColorSection } from "@/components/dev/designSystem/sections/ColorSection";
import { TypographySection } from "@/components/dev/designSystem/sections/TypographySection";
import { IconsSection } from "@/components/dev/designSystem/sections/IconsSection";
import { ComponentsSection } from "@/components/dev/designSystem/sections/ComponentsSection";
import { CardsSection } from "@/components/dev/designSystem/sections/CardsSection";
import { SpacingSection } from "@/components/dev/designSystem/sections/SpacingSection";
import { AssetsSection } from "@/components/dev/designSystem/sections/AssetsSection";

type Mode = "light" | "dark";

export default function DesignSystem() {
  const presetId = usePreferencesStore((s) => s.appThemePreset);
  const setAppThemePreset = usePreferencesStore((s) => s.setAppThemePreset);
  const { resolvedTheme, setTheme } = useColorMode();
  const mode: Mode = resolvedTheme === "light" ? "light" : "dark";

  return (
    <div className="h-full overflow-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <span className="text-sm font-semibold">Design System</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            dev
          </span>
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Theme
            <select
              value={presetId}
              onChange={(e) => setAppThemePreset(e.target.value)}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground pointer-coarse:text-base"
            >
              {THEME_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {(["light", "dark"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setTheme(m)}
                className={cn(
                  "px-2.5 py-1 text-xs capitalize transition-colors",
                  mode === m ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1.5 overflow-x-auto px-4 pb-2 sm:px-6">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="shrink-0 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
        <BrandSection />
        <ColorSection presetId={presetId} />
        <TypographySection />
        <IconsSection />
        <ComponentsSection presetId={presetId} />
        <CardsSection />
        <SpacingSection />
        <AssetsSection />
      </main>
    </div>
  );
}
