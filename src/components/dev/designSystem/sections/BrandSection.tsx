import { ManaBrewLogo } from "@/components/layout/ManaBrewLogo";
import { THEME_PRESETS } from "@/themes";

export function BrandSection() {
  return (
    <section id="brand" className="scroll-mt-24 space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-border">
        <img
          src="/manabrew_brewery_1.png"
          alt="Manabrew brand art"
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />
        <div className="relative flex flex-col gap-4 bg-gradient-to-r from-background/90 to-background/40 p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-8">
          <ManaBrewLogo size={96} className="shrink-0 rounded-2xl shadow-lg" />
          <div className="space-y-1.5">
            <h1 className="font-serif text-4xl font-light tracking-tight">
              Manabrew Design System
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              The complete visual language for the Manabrew MTG client — color, typography, icons,
              components, card faces, and assets. Every sample is a real component, so this page
              never drifts from the app.
            </p>
            <p className="pt-1 font-mono text-[11px] text-muted-foreground">
              {THEME_PRESETS.length} themes · 3 typefaces · rendered live from src/
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
