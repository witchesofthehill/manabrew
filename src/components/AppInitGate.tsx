import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAppInitStore } from "@/stores/useAppInitStore";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { BreweryBackdrop } from "@/components/BreweryBackdrop";
import { cn } from "@/lib/utils";
const BAR_FILL_MS = 200;
// Minimum dwell at the initial `idle` stage. Without it, a cache hit can
// flash through every milestone in a single frame; a brief hold gives the
// progress bar a chance to *start* at a recognizable position before the
// first real stage event yanks it forward.
const INITIAL_HOLD_MS = 300;
/**
 * Each stage maps to a milestone on the progress bar so the fill keeps
 * moving forward visibly even on a warm load, where the app flashes through
 * idle → assets → decks → ready in tens of milliseconds.
 */
const STAGE_PROGRESS: Record<string, number> = {
  idle: 4,
  assets: 35,
  decks: 80,
  ready: 100,
};
const STAGE_TITLE: Record<string, string> = {
  idle: `Starting`,
  assets: `Loading card data`,
  decks: `Loading decks`,
  ready: `Ready`,
};
// Prevents reanimating on re-mount
let hasReleasedOnce = false;
export function AppInitGate({ children }: { children: ReactNode }) {
  const rawStage = useAppInitStore((s) => s.stage);
  const shortScreen = useIsShortScreen();
  const isTouch = useIsTouch();
  const shortTouch = shortScreen && isTouch;

  const [minHoldPassed, setMinHoldPassed] = useState(hasReleasedOnce);
  useEffect(() => {
    if (minHoldPassed) return;
    const t = window.setTimeout(() => setMinHoldPassed(true), INITIAL_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [minHoldPassed]);
  const stage = minHoldPassed ? rawStage : "idle";
  const target = useMemo(() => STAGE_PROGRESS[stage] ?? 0, [stage]);
  type Phase = "gating" | "releasing" | "done";
  const [phase, setPhase] = useState<Phase>(() => (hasReleasedOnce ? "done" : "gating"));
  const HOLD_MS = 300;
  const GATE_MS = 600;
  const CHILD_DELAY_MS = 400;
  const CHILD_MS = 700;
  const EXIT_MS = Math.max(GATE_MS, CHILD_DELAY_MS + CHILD_MS); // 1100ms
  const RELEASE_DELAY_MS = BAR_FILL_MS + HOLD_MS;
  useEffect(() => {
    if (phase === "done") return;
    if (stage !== "ready") return;
    const release = window.setTimeout(() => setPhase("releasing"), RELEASE_DELAY_MS);
    const done = window.setTimeout(() => {
      setPhase("done");
      hasReleasedOnce = true;
    }, RELEASE_DELAY_MS + EXIT_MS);
    return () => {
      window.clearTimeout(release);
      window.clearTimeout(done);
    };
  }, [stage, phase, RELEASE_DELAY_MS, EXIT_MS]);

  // The companion is pure UI with no engine dependency, so never block it behind
  // the worker boot — which can't initialise without cross-origin isolation
  // (e.g. an iOS PWA served over plain http). Render it immediately when it's
  // the entry route. The auth callback must also never be gated: an OAuth
  // redirect must reach the route that exchanges the code without waiting on
  // the engine boot.
  if (
    typeof window !== "undefined" &&
    (window.location.pathname.startsWith("/companion") ||
      window.location.pathname.startsWith("/auth/callback"))
  ) {
    return <>{children}</>;
  }
  const title = STAGE_TITLE[stage] ?? `Loading`;
  const pct = Math.round(target);

  const welcomeHeader = (
    <div className={cn("flex flex-col items-center gap-2 text-center", shortTouch && "gap-0.5")}>
      <p
        className={cn(
          "font-mono text-[0.65rem] uppercase tracking-[0.55em] text-muted-foreground",
          shortTouch && "text-[0.55rem]",
        )}
      >
        Welcome to
      </p>
      <h1
        className={cn(
          "font-serif text-5xl font-light tracking-[0.08em] text-foreground md:text-6xl",
          shortTouch && "text-3xl md:text-3xl",
        )}
      >
        Manabrew
      </h1>
      <div
        aria-hidden
        className={cn(
          "mt-2 h-px w-24 bg-gradient-to-r from-transparent via-foreground/50 to-transparent",
          shortTouch && "mt-0.5",
        )}
      />
    </div>
  );

  const exiting = phase === "releasing";
  const showChildren = phase !== "gating";
  const childWrapper = (
    <div
      style={
        exiting
          ? {
              animation: `manabrew-arrive ${CHILD_MS}ms ${CHILD_DELAY_MS}ms cubic-bezier(0.16, 1, 0.3, 1) both`,
              transformOrigin: "center center",
            }
          : { display: "contents" }
      }
    >
      {showChildren ? children : null}
    </div>
  );
  if (phase === "done") return childWrapper;
  return (
    <>
      {childWrapper}
      <div
        className="fixed inset-0 z-50 overflow-hidden bg-background text-foreground"
        style={
          exiting
            ? {
                animation: `manabrew-dive-in ${GATE_MS}ms cubic-bezier(0.55, 0, 0.85, 0) forwards`,
                transformOrigin: "center center",
              }
            : undefined
        }
      >
        <BreweryBackdrop />

        <div className="absolute inset-0 z-10 overflow-y-auto">
          <div
            className={cn(
              "flex min-h-full w-full flex-col items-center justify-center gap-10 px-8 py-10",
              isTouch && "gap-6 px-4 py-6",
              shortTouch &&
                "h-full min-h-0 gap-3 py-2 [padding-bottom:max(0.5rem,var(--safe-area-inset-bottom))] [padding-left:max(1rem,var(--safe-area-inset-left))] [padding-right:max(1rem,var(--safe-area-inset-right))] [padding-top:max(0.5rem,var(--safe-area-inset-top))]",
            )}
          >
            <div
              className={cn(
                "flex w-full max-w-2xl flex-col items-center gap-10",
                isTouch && "gap-6",
                shortTouch && "h-full min-h-0 max-w-xl justify-center gap-3",
              )}
            >
              {welcomeHeader}
              <div className={cn("w-full space-y-5", shortTouch && "space-y-2.5")}>
                <div
                  className={cn(
                    "flex items-baseline justify-between font-mono text-[0.65rem] uppercase tracking-[0.4em] text-muted-foreground",
                    shortTouch && "text-[0.6rem] tracking-[0.3em]",
                  )}
                >
                  <span className="truncate text-foreground/80">{title}</span>
                  <span className="tabular-nums">{pct.toString().padStart(3, "0")}%</span>
                </div>

                <div
                  className={cn(
                    "relative h-3.5 w-full overflow-hidden rounded-full border border-border/80 bg-muted/40",
                    shortTouch && "h-3",
                  )}
                >
                  <div
                    className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-primary/70 via-primary to-primary/70 shadow-[inset_0_0_8px] shadow-primary/40 transition-[width] duration-200 ease-out"
                    style={{ width: `${target}%` }}
                  >
                    <div
                      aria-hidden
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/45 to-transparent"
                      style={{ animation: "manabrew-shimmer 2.2s linear infinite" }}
                    />
                  </div>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-primary blur-md transition-[left] duration-200 ease-out"
                    style={{ left: `calc(${target}% - 0.5rem)` }}
                  />
                </div>

                <p
                  className={cn(
                    "text-center font-mono text-[0.6rem] uppercase tracking-[0.45em] text-muted-foreground/80",
                    shortTouch && "text-[0.55rem] tracking-[0.35em]",
                  )}
                >
                  Connecting
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Inline keyframes scoped by a manabrew-* prefix. */}
        <style>{`
          @keyframes manabrew-shimmer {
            0%   { transform: translateX(-100%); }
            100% { transform: translateX(200%); }
          }
          /* "Dive in": gate races forward past the camera. Aggressive scale
             so it actually feels like rushing motion (not a gentle zoom).
             Holds opacity through most of the motion, then dumps to zero —
             that's what reads as "the lens passes through" instead of
             "an image fades". Filter blur ramps with motion. */
          @keyframes manabrew-dive-in {
            0% {
              opacity: 1;
              transform: scale(1);
              filter: blur(0px);
            }
            55% {
              opacity: 0.85;
              filter: blur(14px);
            }
            100% {
              opacity: 0;
              transform: scale(2.6);
              filter: blur(48px);
            }
          }
          /* The app rises from depth as the gate races past. The 0% state
             is held during CHILD_DELAY_MS (animation-fill-mode: both),
             so by the time the gate has cleared the children are sitting
             blurred and small — that's the moment we actually want to
             see, since otherwise the gate hides the early frames. */
          @keyframes manabrew-arrive {
            0% {
              opacity: 0;
              transform: scale(0.88);
              filter: blur(12px);
            }
            100% {
              opacity: 1;
              transform: scale(1);
              filter: blur(0);
            }
          }
        `}</style>
      </div>
    </>
  );
}
