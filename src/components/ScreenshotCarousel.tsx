import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const SCREENSHOTS = Object.entries(
  import.meta.glob("/images/screenshots/*.{png,jpg,jpeg,webp}", {
    eager: true,
    query: "?url",
    import: "default",
  }) as Record<string, string>,
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, src]) => ({
    title:
      path
        .split("/")
        .pop()
        ?.replace(/\.\w+$/, "") ?? path,
    src,
  }));

const AUTO_ADVANCE_MS = 4000;

function slideStyle(offset: number): React.CSSProperties {
  if (offset === 0) {
    return { transform: "translate(-50%, -50%) scale(1)", opacity: 1, zIndex: 30 };
  }
  if (Math.abs(offset) === 1) {
    return {
      transform: `translate(calc(-50% + ${offset * 62}%), -50%) scale(0.8)`,
      opacity: 0.45,
      zIndex: 20,
    };
  }
  if (Math.abs(offset) === 2) {
    return {
      transform: `translate(calc(-50% + ${offset * 56}%), -50%) scale(0.64)`,
      opacity: 0.2,
      zIndex: 10,
    };
  }
  return { transform: "translate(-50%, -50%) scale(0.5)", opacity: 0, zIndex: 0 };
}

export function ScreenshotCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || SCREENSHOTS.length < 2) return;
    const t = window.setInterval(
      () => setIndex((i) => (i + 1) % SCREENSHOTS.length),
      AUTO_ADVANCE_MS,
    );
    return () => window.clearInterval(t);
  }, [paused]);

  if (SCREENSHOTS.length === 0) return null;

  const offsetOf = (i: number) => {
    const n = SCREENSHOTS.length;
    const half = Math.floor(n / 2);
    return ((i - index + n + half) % n) - half;
  };

  return (
    <div
      className="space-y-2.5"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative w-full overflow-hidden h-[clamp(180px,32dvh,480px)]">
        {SCREENSHOTS.map((shot, i) => {
          const offset = offsetOf(i);
          return (
            <button
              key={shot.src}
              type="button"
              tabIndex={offset === 0 ? -1 : 0}
              aria-label={offset === 0 ? shot.title : `Show ${shot.title}`}
              onClick={() => setIndex(i)}
              className={cn(
                "absolute left-1/2 top-1/2 h-full aspect-video overflow-hidden rounded-xl border border-border/60 bg-muted/40",
                "transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
                offset === 0 ? "cursor-default shadow-xl" : "cursor-pointer",
              )}
              style={slideStyle(offset)}
            >
              <img
                src={shot.src}
                alt={shot.title}
                draggable={false}
                className="h-full w-full select-none object-cover"
              />
            </button>
          );
        })}
      </div>
      {SCREENSHOTS.length > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {SCREENSHOTS.map((shot, i) => (
            <button
              key={shot.src}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to ${shot.title}`}
              className={cn(
                "h-1.5 rounded-full transition-all duration-500",
                i === index
                  ? "w-5 bg-primary"
                  : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
