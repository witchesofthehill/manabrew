import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { SECTIONS } from "@/components/dev/designSystem/designSystem.data";
import { BrandSection } from "@/components/dev/designSystem/sections/BrandSection";
import { ColorSection } from "@/components/dev/designSystem/sections/ColorSection";
import { TypographySection } from "@/components/dev/designSystem/sections/TypographySection";
import { IconsSection } from "@/components/dev/designSystem/sections/IconsSection";
import { ComponentsSection } from "@/components/dev/designSystem/sections/ComponentsSection";
import { CardsSection } from "@/components/dev/designSystem/sections/CardsSection";
import { SpacingSection } from "@/components/dev/designSystem/sections/SpacingSection";
import { AssetsSection } from "@/components/dev/designSystem/sections/AssetsSection";

export default function DesignSystem() {
  const presetId = usePreferencesStore((s) => s.appThemePreset);

  return (
    <div className="h-full overflow-auto">
      <div className="px-4 pt-6 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-border bg-card p-3">
          <nav className="flex gap-1.5 overflow-x-auto" aria-label="Gallery sections">
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
        </div>
      </div>

      <main className="space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <BrandSection />
        <ColorSection presetId={presetId} />
        <TypographySection />
        <IconsSection />
        <ComponentsSection />
        <CardsSection />
        <SpacingSection />
        <AssetsSection />
      </main>
    </div>
  );
}
