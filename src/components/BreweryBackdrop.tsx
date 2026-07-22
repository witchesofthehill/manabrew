import { cn } from "@/lib/utils";

interface BreweryBackdropProps {
  variant?: "hero" | "ambient" | "subtle";
  className?: string;
}

export function BreweryBackdrop({ variant = "hero", className }: BreweryBackdropProps) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-b from-background to-background",
          variant === "hero" ? "via-card/40" : "via-background/60",
          variant === "subtle" && "via-background/80",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-border to-transparent",
          variant === "subtle" && "opacity-50",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute left-1/2 top-[28%] size-[60vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl",
          variant === "ambient" && "opacity-60",
          variant === "subtle" && "opacity-30",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute left-1/2 top-[60%] size-[45vw] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl",
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
