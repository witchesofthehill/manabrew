import { AlertCircle } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAppInitStore } from "@/stores/useAppInitStore";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAcknowledgement } from "@/hooks/useAcknowledgement";
import { OnboardingWelcome, ONBOARDING_GUIDE_VERSION } from "@/components/OnboardingWelcome";
import { BreweryBackdrop } from "@/components/BreweryBackdrop";
import { TERMS_AND_CONDITIONS } from "@/lib/termsContent";

const TERMS_STORAGE_KEY = "manabrew.termsAcceptance";
const ONBOARDING_STORAGE_KEY = "manabrew.onboarding";

const BAR_FILL_MS = 200;
// Minimum dwell at the initial `idle` stage. Without it, a cache hit can
// flash through every milestone in a single frame; a brief hold gives the
// progress bar a chance to *start* at a recognizable position before the
// first real stage event yanks it forward.
const INITIAL_HOLD_MS = 300;

/**
 * Each stage maps to a milestone on the progress bar so the fill keeps
 * moving forward visibly even on cached loads (where the worker flashes
 * through idle → cached → parsing → presets → ready in tens of
 * milliseconds). For the downloading stage we honor the real `loaded/total`
 * ratio, but cap it at 60% so the parsing + presets stages still get
 * dedicated visual real-estate at the end.
 */
const STAGE_PROGRESS: Record<string, number> = {
  idle: 4,
  cached: 30,
  downloading: 0, // computed from loaded/total when active
  parsing: 75,
  presets: 92,
  ready: 100,
  error: 0,
};

const STAGE_TITLE: Record<string, string> = {
  idle: "Starting",
  cached: "Loading engine",
  downloading: "Downloading card data",
  parsing: "Parsing cards",
  presets: "Loading decks",
  ready: "Ready",
};

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// Prevents reanimating on re-mount
let hasReleasedOnce = false;

export function AppInitGate({ children }: { children: ReactNode }) {
  const rawStage = useAppInitStore((s) => s.stage);
  const loaded = useAppInitStore((s) => s.loaded);
  const total = useAppInitStore((s) => s.total);
  const errorMessage = useAppInitStore((s) => s.errorMessage);
  const { accepted: termsAccepted, accept: acceptTerms } = useAcknowledgement(
    TERMS_STORAGE_KEY,
    TERMS_AND_CONDITIONS.version,
  );
  const { accepted: onboardingDone, accept: completeOnboarding } = useAcknowledgement(
    ONBOARDING_STORAGE_KEY,
    ONBOARDING_GUIDE_VERSION,
  );
  const [consent, setConsent] = useState(false);

  const [minHoldPassed, setMinHoldPassed] = useState(hasReleasedOnce);
  useEffect(() => {
    if (minHoldPassed) return;
    const t = window.setTimeout(() => setMinHoldPassed(true), INITIAL_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [minHoldPassed]);

  const stage = minHoldPassed ? rawStage : "idle";

  // Compute the progress target. During `downloading`, the bar reflects
  // bytes-loaded mapped into the 0–60% window so the parsing / presets
  // stages still have headroom to advance the visual.
  const target = useMemo(() => {
    if (stage === "downloading") {
      if (total > 0) {
        return Math.min(60, (loaded / total) * 60);
      }
      return 8;
    }
    return STAGE_PROGRESS[stage] ?? 0;
  }, [stage, loaded, total]);

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
    if (!termsAccepted || !onboardingDone) return;
    const release = window.setTimeout(() => setPhase("releasing"), RELEASE_DELAY_MS);
    const done = window.setTimeout(() => {
      setPhase("done");
      hasReleasedOnce = true;
    }, RELEASE_DELAY_MS + EXIT_MS);
    return () => {
      window.clearTimeout(release);
      window.clearTimeout(done);
    };
  }, [stage, phase, termsAccepted, onboardingDone, RELEASE_DELAY_MS, EXIT_MS]);

  // The companion is pure UI with no engine dependency, so never block it behind
  // the worker boot — which can't initialise without cross-origin isolation
  // (e.g. an iOS PWA served over plain http). Render it immediately when it's
  // the entry route.
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/companion")) {
    return <>{children}</>;
  }

  if (stage === "error") {
    return (
      <div className="fixed inset-0 grid place-items-center bg-background p-8">
        <div className="flex max-w-md flex-col items-center gap-5 rounded-lg border border-destructive/40 bg-card/80 px-10 py-12 text-center shadow-xl backdrop-blur">
          <AlertCircle className="size-10 text-destructive" />
          <h2 className="text-xl font-semibold text-foreground">Couldn't load the game engine</h2>
          <p className="font-mono text-xs leading-relaxed text-muted-foreground">
            {errorMessage ?? "Unknown error during startup."}
          </p>
          <Button variant="outline" size="default" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }

  const title = STAGE_TITLE[stage] ?? "Loading";
  const pct = Math.round(target);
  const showBytes = total > 0;
  const showTerms = stage === "ready" && !termsAccepted;
  const showOnboarding = stage === "ready" && termsAccepted && !onboardingDone;

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
          <div className="flex min-h-full w-full flex-col items-center justify-center gap-10 px-8 py-10">
            <div className="flex w-full max-w-2xl flex-col items-center gap-10 drop-shadow-2xl">
              <div className="flex flex-col items-center gap-2 text-center">
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.55em] text-muted-foreground">
                  Welcome to
                </p>
                <h1 className="font-serif text-5xl font-light tracking-[0.08em] text-foreground md:text-6xl">
                  Manabrew
                </h1>
                <div
                  aria-hidden
                  className="mt-2 h-px w-24 bg-gradient-to-r from-transparent via-foreground/50 to-transparent"
                />
              </div>

              {showTerms ? (
                <div className="w-full space-y-5">
                  <div className="space-y-1 text-center">
                    <p className="font-mono text-[0.6rem] uppercase tracking-[0.45em] text-muted-foreground/80">
                      {TERMS_AND_CONDITIONS.title}
                    </p>
                    <p className="text-sm text-muted-foreground">{TERMS_AND_CONDITIONS.intro}</p>
                  </div>

                  <ScrollArea className="h-[38vh] max-h-[360px]">
                    <div className="space-y-4 pr-4 text-sm leading-relaxed">
                      {TERMS_AND_CONDITIONS.sections.map((section) => (
                        <section key={section.heading} className="space-y-1.5">
                          <h3 className="text-sm font-semibold text-foreground">
                            {section.heading}
                          </h3>
                          <p className="text-sm text-muted-foreground">{section.body}</p>
                        </section>
                      ))}
                    </div>
                  </ScrollArea>

                  <label className="flex cursor-pointer select-none items-start justify-center gap-2.5 text-sm">
                    <Checkbox
                      checked={consent}
                      onCheckedChange={(value) => setConsent(value === true)}
                      className="mt-0.5"
                    />
                    <span className="text-foreground">I have read and agree to these terms</span>
                  </label>

                  <div className="flex flex-col items-center gap-3">
                    <Button disabled={!consent} onClick={acceptTerms} className="min-w-[200px]">
                      Accept and continue
                    </Button>
                    <p className="font-mono text-[0.55rem] uppercase tracking-[0.4em] text-muted-foreground/70">
                      Version {TERMS_AND_CONDITIONS.version} · Updated{" "}
                      {TERMS_AND_CONDITIONS.lastUpdated}
                    </p>
                  </div>
                </div>
              ) : showOnboarding ? (
                <OnboardingWelcome onComplete={completeOnboarding} />
              ) : (
                <div className="w-full space-y-5">
                  <div className="flex items-baseline justify-between font-mono text-[0.65rem] uppercase tracking-[0.4em] text-muted-foreground">
                    <span className="truncate text-foreground/80">{title}</span>
                    <span className="tabular-nums">{pct.toString().padStart(3, "0")}%</span>
                  </div>

                  {/* The bar itself: thick track, gradient fill, shimmering overlay,
                and a soft glow at the leading edge. */}
                  <div className="relative h-3.5 w-full overflow-hidden rounded-full border border-border/80 bg-muted/40">
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
                    {/* Trailing glow that follows the leading edge of the fill. */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-primary blur-md transition-[left] duration-200 ease-out"
                      style={{ left: `calc(${target}% - 0.5rem)` }}
                    />
                  </div>

                  {/* Tech line — bytes during download, otherwise a quiet note
                about caching. No flavor copy. */}
                  <p className="text-center font-mono text-[0.6rem] uppercase tracking-[0.45em] text-muted-foreground/80">
                    {stage === "downloading" && showBytes ? (
                      <>
                        {formatBytes(loaded)} / {formatBytes(total)}
                      </>
                    ) : (
                      <>Connecting</>
                    )}
                  </p>
                </div>
              )}
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
