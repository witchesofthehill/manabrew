import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
export function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  // Expand when the jump-nav (or a shared #hash link) targets this section.
  useEffect(() => {
    const openIfTargeted = () => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    openIfTargeted();
    window.addEventListener("hashchange", openIfTargeted);
    return () => window.removeEventListener("hashchange", openIfTargeted);
  }, [id]);
  return (
    <section id={id} className="ds-section scroll-mt-24 border-t border-border pt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${id}-content`}
        className="ds-section-toggle flex min-h-9 w-full items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11"
      >
        <ChevronRight
          className={cn(
            "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <h2 className="font-serif text-2xl font-semibold tracking-tight">{title}</h2>
      </button>
      <div
        id={`${id}-content`}
        className={cn("ds-section-content space-y-6 pt-4", !open && "hidden")}
      >
        {intro && <p className="max-w-2xl text-ui-body text-muted-foreground">{intro}</p>}
        {children}
      </div>
    </section>
  );
}
export function Subhead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="ds-subhead text-ui-label font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </h3>
  );
}
export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("ds-panel min-w-0 rounded-lg border border-border bg-card p-5", className)}>
      {children}
    </div>
  );
}
export function CopyChip({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className={cn(
        "inline-flex min-h-8 max-w-full items-center rounded font-mono text-ui-label break-all text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11 touch:min-w-11",
        className,
      )}
      title={`Copy ${value}`}
    >
      <span className="ds-screen-only">{copied ? `copied` : value}</span>
      <span className="ds-print-only">{value}</span>
    </button>
  );
}
// Alpha checkerboard sits behind translucent (rgba) token values so they read
// correctly rather than blending into the card surface. Squares are derived
// from a theme token (color-mix) to keep the page free of hex literals.
const CHECKER = "color-mix(in srgb, var(--muted-foreground) 30%, transparent)";
const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage: `linear-gradient(45deg, ${CHECKER} 25%, transparent 25%), linear-gradient(-45deg, ${CHECKER} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${CHECKER} 75%), linear-gradient(-45deg, transparent 75%, ${CHECKER} 75%)`,
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};
export function Swatch({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="ds-swatch overflow-hidden rounded-lg border border-border bg-card">
      <div className="h-16" style={CHECKER_STYLE}>
        <div className="h-full w-full" style={{ background: value }} />
      </div>
      <div className="space-y-0.5 p-2">
        <div className="text-ui-label font-semibold break-words">{label}</div>
        {sub && <div className="text-ui-meta break-words text-muted-foreground">{sub}</div>}
        <CopyChip value={value} />
      </div>
    </div>
  );
}
export function SwatchGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="ds-swatch-grid grid grid-cols-[repeat(auto-fill,minmax(min(100%,160px),1fr))] gap-2">
      {children}
    </div>
  );
}
export function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ds-tile flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-3 text-center">
      <div className="flex min-h-9 items-center justify-center">{children}</div>
      <span className="text-ui-meta break-words text-muted-foreground">{label}</span>
    </div>
  );
}
export function TileGrid({ min = 92, children }: { min?: number; children: React.ReactNode }) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(auto-fill,minmax(min(100%,${min}px),1fr))` }}
    >
      {children}
    </div>
  );
}
