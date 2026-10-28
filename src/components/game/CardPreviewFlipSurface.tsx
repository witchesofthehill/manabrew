import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { PREVIEW_TIMING } from "@/lib/cardPreview";
import { animationsEnabled, subscribeAnimationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";

export interface CardPreviewFlipHandle {
  close(): Promise<void>;
  setClosed(): void;
  open(): void;
  cancel(): void;
  isReady(): boolean;
}

interface CardPreviewFlipSurfaceProps {
  contentKey: string;
  local: boolean;
  active: boolean;
  backFace: boolean;
  onDisplayFace: (backFace: boolean) => void;
  flipClosed?: boolean;
  onPresentationReady?: () => void;
  flipHandleRef?: RefObject<CardPreviewFlipHandle | null>;
  children: ReactNode;
}

interface PreviewFrame {
  key: string;
  backFace: boolean;
  children: ReactNode;
}

function contentReady(element: HTMLElement | null): boolean {
  if (!element) return false;
  const generated = element.querySelector<HTMLElement>("[data-card-render-state]");
  if (generated?.dataset.cardRenderState === "loading") return false;
  if (generated?.dataset.cardRenderState === "ready") return true;
  const image = element.querySelector<HTMLElement>("[data-card-preview-image-ready]");
  if (image) return image.dataset.cardPreviewImageReady === "true";
  return !element.querySelector("[data-card-preview-loading]");
}

export function CardPreviewFlipSurface({
  contentKey,
  local,
  active,
  backFace,
  onDisplayFace,
  flipHandleRef,
  children,
  flipClosed = false,
  onPresentationReady,
}: CardPreviewFlipSurfaceProps) {
  const surface = useRef<HTMLDivElement>(null);
  const pendingElement = useRef<HTMLDivElement>(null);
  const resolveClose = useRef<(() => void) | null>(null);
  const [displayed, setDisplayed] = useState<PreviewFrame>({ key: contentKey, backFace, children });
  const pending = local && contentKey !== displayed.key;
  const incoming = useRef({ key: contentKey, backFace, children, onDisplayFace });
  useLayoutEffect(() => {
    incoming.current = { key: contentKey, backFace, children, onDisplayFace };
  });
  const displayedChildren = pending ? displayed.children : children;
  if (!pending && (displayed.key !== contentKey || displayed.children !== children)) {
    setDisplayed({ key: contentKey, backFace, children });
  }

  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    const stop = () => {
      gsap.killTweensOf(element);
      resolveClose.current?.();
      resolveClose.current = null;
    };
    const cancel = () => {
      stop();
      gsap.set(element, { clearProps: "transform,transformOrigin" });
    };
    const handle: CardPreviewFlipHandle = {
      cancel,
      isReady: () => contentReady(element),
      setClosed: () => {
        cancel();
        if (active && animationsEnabled()) {
          gsap.set(element, {
            rotationY: 90,
            transformPerspective: 900,
            transformOrigin: "50% 50%",
          });
        }
      },
      close: () => {
        stop();
        if (!active || !animationsEnabled()) return Promise.resolve();
        return new Promise<void>((resolve) => {
          resolveClose.current = resolve;
          gsap.set(element, { transformPerspective: 900, transformOrigin: "50% 50%" });
          const rotation = Number(gsap.getProperty(element, "rotationY"));
          const edge = rotation < 0 ? -90 : 90;
          gsap.to(element, {
            rotationY: edge,
            duration: (PREVIEW_TIMING.flipHalfMs / 1000) * (Math.abs(edge - rotation) / 90),
            ease: "none",
            onComplete: () => {
              resolveClose.current = null;
              resolve();
            },
          });
        });
      },
      open: () => {
        cancel();
        if (!active || !animationsEnabled()) return;
        gsap.fromTo(
          element,
          { rotationY: -90, transformPerspective: 900, transformOrigin: "50% 50%" },
          {
            rotationY: 0,
            duration: PREVIEW_TIMING.flipHalfMs / 1000,
            ease: "none",
            onComplete: cancel,
          },
        );
      },
    };
    if (flipHandleRef) flipHandleRef.current = handle;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const policyChanged = () => {
      if (!animationsEnabled()) cancel();
    };
    const unsubscribe = subscribeAnimationsEnabled(policyChanged);
    media.addEventListener("change", policyChanged);
    return () => {
      cancel();
      unsubscribe();
      media.removeEventListener("change", policyChanged);
      if (flipHandleRef?.current === handle) flipHandleRef.current = null;
    };
  }, [active, flipHandleRef]);

  useLayoutEffect(() => {
    if (!local || !pending) return;
    const element = surface.current;
    const target = pendingElement.current;
    if (!element || !target) return;
    let cancelled = false;
    let edgeReached = false;
    let committed = false;
    const commit = () => {
      if (cancelled || committed || !edgeReached || !contentReady(target)) return;
      committed = true;
      const next = incoming.current;
      setDisplayed(next);
      next.onDisplayFace(next.backFace);
    };
    const prepare = () => {
      gsap.killTweensOf(element);
      if (
        !active ||
        !animationsEnabled() ||
        !contentReady(element.firstElementChild as HTMLElement)
      ) {
        edgeReached = true;
        commit();
        return;
      }
      gsap.set(element, { transformPerspective: 900, transformOrigin: "50% 50%" });
      const rotation = Number(gsap.getProperty(element, "rotationY"));
      const edge = rotation < 0 ? -90 : 90;
      gsap.to(element, {
        rotationY: edge,
        duration: (PREVIEW_TIMING.flipHalfMs / 1000) * (Math.abs(edge - rotation) / 90),
        ease: "none",
        onComplete: () => {
          edgeReached = true;
          commit();
        },
      });
    };
    const observer = new MutationObserver(commit);
    observer.observe(target, {
      attributes: true,
      attributeFilter: ["data-card-render-state", "data-card-preview-image-ready"],
      childList: true,
      subtree: true,
    });
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const policyChanged = () => {
      if (animationsEnabled()) return;
      gsap.killTweensOf(element);
      gsap.set(element, { clearProps: "transform,transformOrigin" });
      edgeReached = true;
      commit();
    };
    const unsubscribe = subscribeAnimationsEnabled(policyChanged);
    media.addEventListener("change", policyChanged);
    prepare();
    return () => {
      cancelled = true;
      observer.disconnect();
      unsubscribe();
      media.removeEventListener("change", policyChanged);
      gsap.killTweensOf(element);
    };
  }, [local, pending, contentKey, backFace, active]);

  useLayoutEffect(() => {
    if (!local || pending) return;
    const element = surface.current;
    if (!element) return;
    if (gsap.getProperty(element, "rotationY") !== 0 && active && animationsEnabled()) {
      gsap.fromTo(
        element,
        { rotationY: -90, transformPerspective: 900, transformOrigin: "50% 50%" },
        {
          rotationY: 0,
          duration: PREVIEW_TIMING.flipHalfMs / 1000,
          ease: "none",
          clearProps: "transform,transformOrigin",
        },
      );
    } else {
      gsap.set(element, { clearProps: "transform,transformOrigin" });
    }
  }, [local, pending, displayed.key, active]);

  useLayoutEffect(() => {
    if (flipClosed) flipHandleRef?.current?.setClosed();
  }, [flipClosed, flipHandleRef]);

  useLayoutEffect(() => {
    const element = surface.current;
    if (!element || !onPresentationReady) return;
    let reported = false;
    let cancelled = false;
    const report = () => {
      if (cancelled || reported || !contentReady(element)) return;
      reported = true;
      onPresentationReady();
    };
    const observer = new MutationObserver(report);
    observer.observe(element, {
      attributes: true,
      attributeFilter: ["data-card-render-state", "data-card-preview-image-ready"],
      childList: true,
      subtree: true,
    });
    queueMicrotask(report);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [contentKey, onPresentationReady]);

  return (
    <div ref={surface} className="relative h-full w-full">
      <div key={local ? displayed.key : "controlled"} className="absolute inset-0">
        {displayedChildren}
      </div>
      {pending && (
        <div
          key={contentKey}
          ref={pendingElement}
          className="absolute inset-0 invisible pointer-events-none"
          aria-hidden
          inert
        >
          {children}
        </div>
      )}
    </div>
  );
}
