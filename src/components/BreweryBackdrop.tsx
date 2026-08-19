import { cn } from "@/lib/utils";

interface BreweryBackdropProps {
  variant?: "hero" | "ambient" | "subtle";
  className?: string;
}

/**
 * A soft radial fade, used in place of `blur-3xl` on the two glow discs.
 *
 * A CSS `filter: blur()` on a disc this large (60vw) is a real Gaussian pass
 * over millions of pixels, and WebKit runs it on the CPU (vImage) once the
 * surface is big enough. A mask is a compositing operation instead, and reads
 * near-identically for a shape whose only job is to fade out at the edges.
 */
const GLOW_MASK =
  "radial-gradient(closest-side, #000 0%, rgba(0,0,0,0.72) 34%, " +
  "rgba(0,0,0,0.32) 60%, rgba(0,0,0,0.08) 82%, transparent 100%)";

export function BreweryBackdrop({ variant = "hero", className }: BreweryBackdropProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        // Promote to its own compositing layer. The backdrop never changes, but
        // it shares a layer with animated siblings (the init gate's shimmer, the
        // app's transitions), so every one of their frames was re-rasterising
        // the blurred artwork below. Isolated, it rasterises once.
        "transform-gpu",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-b from-background to-background",
          variant === "hero" ? "via-card/40" : "via-background/60",
          variant === "subtle" && "via-background/80",
        )}
      />
      <div
        style={{ maskImage: GLOW_MASK, WebkitMaskImage: GLOW_MASK }}
        className={cn(
          "pointer-events-none absolute left-1/2 top-[28%] size-[60vw] -translate-x-1/2 -translate-y-1/2 bg-primary/10",
          variant === "ambient" && "opacity-60",
          variant === "subtle" && "opacity-30",
        )}
      />
      <div
        style={{ maskImage: GLOW_MASK, WebkitMaskImage: GLOW_MASK }}
        className={cn(
          "pointer-events-none absolute left-1/2 top-[60%] size-[45vw] -translate-x-1/2 bg-primary/5",
          variant === "ambient" && "opacity-60",
          variant === "subtle" && "opacity-30",
        )}
      />
      <img
        src="/manabrew_brewery_1.png"
        alt=""
        draggable={false}
        className={cn(
          "pointer-events-none absolute inset-0 size-full select-none object-cover",
          variant === "hero" && "opacity-50 blur-md",
          variant === "ambient" && "opacity-20 blur-xl",
          variant === "subtle" && "opacity-10 blur-2xl",
        )}
      />
    </div>
  );
}
