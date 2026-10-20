import { useRef, useState } from "react";
import { useTheme as useColorMode } from "next-themes";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { prepareDesignSystemPrint } from "@/components/dev/designSystem/designSystem.print";
import "@/components/dev/designSystem/designSystem.print.css";
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
  const reference = useRef<HTMLDivElement>(null);
  const [preparing, setPreparing] = useState(false);
  const { resolvedTheme } = useColorMode();
  async function exportPdf() {
    setPreparing(true);
    const root = reference.current!;
    try {
      await prepareDesignSystemPrint(root);
      if (!root.isConnected) return;
      const title = document.title;
      try {
        document.title = `Manabrew design system - ${resolvedTheme}`;
        window.print();
      } finally {
        document.title = title;
      }
    } catch (error) {
      if (root.isConnected) {
        toast.error(error instanceof Error ? error.message : "Could not open PDF export.");
      }
    } finally {
      setPreparing(false);
    }
  }
  return (
    <div ref={reference} className="design-system h-full overflow-auto">
      <div className="ds-screen-only px-4 pt-6 sm:px-6 lg:px-8">
        <div className="space-y-3 rounded-xl border border-border bg-card p-3">
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground" role="status">
              {preparing
                ? "Preparing fonts, card examples, and images…"
                : "Export every section, including collapsed content. Choose Save as PDF in the print dialog."}
            </p>
            <Button variant="primary" onClick={() => void exportPdf()} disabled={preparing}>
              <Printer aria-hidden="true" />
              {preparing ? "Preparing PDF…" : "Export PDF"}
            </Button>
          </div>
        </div>
      </div>

      <main className="space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="ds-print-only ds-print-header space-y-2">
          <h1 className="font-serif text-3xl font-semibold">Manabrew design system</h1>
          <p className="text-sm text-muted-foreground">
            Designer reference · {new Date().toLocaleDateString("en-GB")} · {resolvedTheme}{" "}
            component specimens
          </p>
          <p className="text-xs text-muted-foreground">
            Includes current personal color overrides, both app color modes, and all card-face
            styles.
          </p>
        </header>
        <BrandSection />
        <nav className="ds-print-only space-y-3" aria-label="Reference contents">
          <p className="font-semibold">Reference contents</p>
          <ol className="grid list-inside list-decimal grid-cols-2 gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {SECTIONS.map((section) => (
              <li key={section.id}>{section.label}</li>
            ))}
          </ol>
        </nav>
        <ColorSection />
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
