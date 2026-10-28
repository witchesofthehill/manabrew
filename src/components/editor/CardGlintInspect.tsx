import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import type { DeckCard } from "@/protocol/deck";
import { CardGlintInspectScene } from "@/lib/cardGlintInspect";
import type { CardInspectState } from "@/lib/cardGlintInspect";
import type { CardInspectAppearance } from "@/lib/cardGlintInspectAppearance";
import { isEtchedOnlyPrinting, resolveCardFinish } from "@/lib/cardFinish";
import { isHorizontalCard, isTwoFaceLayout } from "@/lib/cardLayout";
import { useCard, useScryfallStore } from "@/stores/useScryfallStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEFAULT_CARD_POSE, MAX_CARD_TILT } from "@/lib/cardLighting";
import type { CardLightingMode, CardPose } from "@/lib/cardLighting";

const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const subscribeMotion = (notify: () => void) => {
  motionPreference.addEventListener("change", notify);
  return () => motionPreference.removeEventListener("change", notify);
};
const motionSnapshot = () => motionPreference.matches;
const KEYBOARD_TILT_STEP = 0.08;

export function CardGlintInspect({
  card,
  className,
  appearance,
  faceIndex: controlledFaceIndex,
  onFlipFace,
  lighting = "pointer",
  pose,
  onPoseChange,
}: {
  card: DeckCard;
  className?: string;
  appearance?: CardInspectAppearance;
  faceIndex?: 0 | 1;
  onFlipFace?: () => void;
  lighting?: CardLightingMode;
  pose?: CardPose;
  onPoseChange?: (pose: CardPose) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CardGlintInspectScene | null>(null);
  const pendingRef = useRef<Promise<CardGlintInspectScene | undefined> | null>(null);
  const [state, setState] = useState<CardInspectState>({ status: "loading" });
  const [requestedFaceIndex, setFaceIndex] = useState<0 | 1>(0);
  const [original, setOriginal] = useState(false);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot);
  const animations = usePreferencesStore((value) => value.inGameAnimations);
  const locale = useScryfallStore((value) => value.locale);
  const printing = useCard({
    name: card.identity.name,
    setCode: card.identity.setCode || undefined,
    cardNumber: card.identity.cardNumber || undefined,
  });
  const finish = resolveCardFinish(
    !!card.identity.foil,
    card.identity.cosmetics,
    isEtchedOnlyPrinting(printing?.info.finishes),
  );
  const animated = !paused && !reducedMotion && animations;
  const hasBack = !!card.backFace || isTwoFaceLayout(card.layout || printing?.info.layout);
  const faceIndex = hasBack ? (controlledFaceIndex ?? requestedFaceIndex) : 0;
  const landscape =
    faceIndex === 1
      ? isHorizontalCard({
          typeLine: card.backFace?.typeLine || printing?.info.card_faces?.[1]?.type_line,
        })
      : isHorizontalCard({
          layout: card.layout || printing?.info.layout,
          types: card.types,
          typeLine: printing?.info.card_faces?.[0]?.type_line || printing?.info.type_line,
        });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    let owned: CardGlintInspectScene | undefined;
    const pending = CardGlintInspectScene.create(canvas, (next) => {
      if (alive) setState(next);
    })
      .then((scene) => {
        if (!alive) {
          scene.dispose();
          return undefined;
        }
        owned = scene;
        sceneRef.current = scene;
        return scene;
      })
      .catch((error: unknown) => {
        if (alive)
          setState({
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        return undefined;
      });
    pendingRef.current = pending;
    return () => {
      alive = false;
      if (sceneRef.current === owned) sceneRef.current = null;
      if (pendingRef.current === pending) pendingRef.current = null;
      owned?.dispose();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void pendingRef.current?.then((scene) => {
      if (alive) scene?.setAppearance(appearance);
    });
    return () => {
      alive = false;
    };
  }, [appearance]);

  useEffect(() => {
    let alive = true;
    void pendingRef.current?.then((scene) => {
      if (!alive) return;
      scene?.setLighting(lighting);
      scene?.setPose(pose);
    });
    return () => {
      alive = false;
    };
  }, [lighting, pose]);

  useEffect(() => {
    let alive = true;
    void pendingRef.current?.then((scene) => {
      if (alive) return scene?.setCard(card, faceIndex, finish, original, landscape);
    });
    return () => {
      alive = false;
    };
  }, [card, faceIndex, finish, original, landscape, locale]);

  useEffect(() => {
    let alive = true;
    void pendingRef.current?.then((scene) => {
      if (alive) scene?.setAnimated(animated);
    });
    return () => {
      alive = false;
    };
  }, [animated]);

  const resetPose = () => {
    if (pose) onPoseChange?.(DEFAULT_CARD_POSE);
    sceneRef.current?.reset();
  };
  const tiltPose = (yaw: number, pitch: number) => {
    if (!pose) {
      sceneRef.current?.tilt(yaw, pitch);
      return;
    }
    onPoseChange?.({
      yaw: Math.max(-MAX_CARD_TILT, Math.min(MAX_CARD_TILT, pose.yaw + yaw)),
      pitch: Math.max(-MAX_CARD_TILT, Math.min(MAX_CARD_TILT, pose.pitch + pitch)),
    });
  };

  return (
    <section
      className={cn("flex min-w-0 flex-col p-3", className)}
      aria-label="Live card customization preview"
    >
      <div
        className="relative my-auto w-full"
        style={{ aspectRatio: landscape ? "7 / 5" : "5 / 7" }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          tabIndex={0}
          aria-label={`${card.identity.name}, ${finish} finish. Arrow keys tilt the card; Home resets the view.`}
          aria-busy={state.status === "loading"}
          data-card-inspect-state={state.status}
          data-card-inspect-finish={finish}
          data-card-inspect-lighting={lighting}
          className="absolute inset-0 h-full w-full touch-pan-y rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onPointerMove={(event) => sceneRef.current?.point(event.clientX, event.clientY)}
          onPointerLeave={() => sceneRef.current?.leavePoint()}
          onKeyDown={(event) => {
            const scene = sceneRef.current;
            if (!scene) return;
            switch (event.key) {
              case "ArrowLeft":
                tiltPose(-KEYBOARD_TILT_STEP, 0);
                break;
              case "ArrowRight":
                tiltPose(KEYBOARD_TILT_STEP, 0);
                break;
              case "ArrowUp":
                tiltPose(0, -KEYBOARD_TILT_STEP);
                break;
              case "ArrowDown":
                tiltPose(0, KEYBOARD_TILT_STEP);
                break;
              case "Home":
                resetPose();
                break;
              default:
                return;
            }
            event.preventDefault();
            event.stopPropagation();
          }}
        />
        {state.status === "loading" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2
              className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-hidden="true"
            />
          </div>
        )}
        {state.status === "error" && (
          <p
            role="alert"
            className="absolute inset-4 flex items-center justify-center break-words bg-background/90 p-3 text-ui-label text-destructive"
          >
            Preview unavailable: {state.error}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOriginal((value) => !value)}
          aria-pressed={original}
        >
          {original ? "Show Manabrew" : "Show Realistic"}
        </Button>
        {hasBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (controlledFaceIndex !== undefined) onFlipFace?.();
              else setFaceIndex((value) => (value === 0 ? 1 : 0));
            }}
            disabled={controlledFaceIndex !== undefined && !onFlipFace}
          >
            {faceIndex === 0 ? "Back face" : "Front face"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setPaused((value) => !value)}
          disabled={reducedMotion || !animations}
          aria-label={paused ? "Resume card motion" : "Pause card motion"}
          aria-pressed={paused}
        >
          {paused || reducedMotion || !animations ? (
            <Play className="h-4 w-4" />
          ) : (
            <Pause className="h-4 w-4" />
          )}
        </Button>
        <Button variant="ghost" size="icon" onClick={resetPose} aria-label="Reset card view">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
      <p className="mt-2 text-center text-ui-meta text-muted-foreground" role="status">
        {state.status === "loading"
          ? "Preparing card…"
          : state.original && !original
            ? "Selected printing layout preserved."
            : pose || lighting === "studio"
              ? "Use pose controls or arrow keys to tilt. Pointer hits move water."
              : "Move over the card or use arrow keys to tilt."}
      </p>
      <p className="sr-only">{card.text}</p>
    </section>
  );
}
