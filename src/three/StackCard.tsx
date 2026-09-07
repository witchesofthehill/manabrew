import cardBack from "@/three/assets/card-back.png";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { StackObjectDto } from "@manabrew/protocol";
import { cardScreenTransform, takeCastOrigin } from "@/three/castMotion";

export function StackCard({
  spell,
  depth,
  image,
  onMotion,
  onHover,
}: {
  spell: StackObjectDto;
  depth: number;
  image: string;
  onMotion: (active: boolean) => void;
  onHover: (id: string | null) => void;
}) {
  const [loadedImage, setLoadedImage] = useState("");
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;
    const pending = new Image();
    pending.crossOrigin = "anonymous";
    pending.onload = () => {
      if (!cancelled) setLoadedImage(image);
    };
    pending.onerror = () => {
      if (!cancelled && attempts++ < 2)
        timer = window.setTimeout(() => {
          pending.src = image;
        }, attempts * 1200);
    };
    pending.src = image;
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      pending.onload = pending.onerror = null;
    };
  }, [image]);
  const host = useRef<HTMLSpanElement>(null);
  const notify = useRef(onMotion);
  useLayoutEffect(() => {
    notify.current = onMotion;
  }, [onMotion]);
  useLayoutEffect(() => {
    const target = host.current!;
    const root = target.closest(".arena-root");
    const origin = root && takeCastOrigin(root, spell.sourceId);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    target.style.transition = "none";
    if (!origin) {
      target.style.animation = "none";
      target.dataset.arriving = "true";
      notify.current(true);
      const arrival = target.animate(
        [
          { opacity: 0, translate: "0 18px", scale: 0.92 },
          { opacity: 1, translate: "0 0", scale: 1 },
        ],
        { duration: 320, easing: "cubic-bezier(.22,.7,.2,1)" },
      );
      let done = false;
      const finishArrival = () => {
        if (done) return;
        done = true;
        delete target.dataset.arriving;
        target.style.removeProperty("transition");
        notify.current(false);
      };
      arrival.onfinish = finishArrival;
      return () => {
        arrival.cancel();
        finishArrival();
      };
    }
    target.style.animation = "none";
    target.dataset.flying = "true";
    const face = target.querySelector("img")!;
    const rect = face.getBoundingClientRect();
    const width = face.offsetWidth,
      height = face.offsetHeight;
    const rotation = new DOMMatrix(getComputedStyle(target).transform);
    const xs = [
      0,
      rotation.a * width,
      rotation.c * height,
      rotation.a * width + rotation.c * height,
    ];
    const ys = [
      0,
      rotation.b * width,
      rotation.d * height,
      rotation.b * width + rotation.d * height,
    ];
    const destination = `matrix(${rotation.a},${rotation.b},${rotation.c},${rotation.d},${rect.left - Math.min(...xs)},${rect.top - Math.min(...ys)})`;
    const flight = face.cloneNode(true) as HTMLImageElement;
    flight.className = "duel-cast-flight";
    flight.setAttribute("aria-hidden", "true");
    flight.style.width = `${width}px`;
    flight.style.height = `${height}px`;
    document.body.appendChild(flight);
    notify.current(true);
    const animation = flight.animate(
      [
        { transform: cardScreenTransform(origin.corners, width, height) },
        { transform: destination },
      ],
      { duration: 480, easing: "cubic-bezier(.22,.7,.2,1)", fill: "both" },
    );
    let finished = false;
    const finish = (landed = false) => {
      if (finished) return;
      finished = true;
      delete target.dataset.flying;
      target.style.removeProperty("transition");
      flight.remove();
      if (landed) {
        face.animate(
          [
            { filter: "brightness(1.25)", scale: 1.025 },
            { filter: "brightness(1)", scale: 1 },
          ],
          { duration: 200, easing: "ease-out" },
        );
      }
      notify.current(false);
    };
    animation.onfinish = () => finish(true);
    return () => {
      animation.cancel();
      finish();
    };
  }, [spell.sourceId]);
  return (
    <span
      ref={host}
      data-stack-id={spell.id}
      className="duel-stack-card"
      style={{ "--depth": depth } as CSSProperties}
      onMouseEnter={() => onHover(spell.id)}
    >
      <img
        src={loadedImage === image ? image : cardBack}
        crossOrigin="anonymous"
        alt={spell.identity.name}
        draggable={false}
      />
      <b>{depth === 0 ? "NEXT" : `+${depth}`}</b>
    </span>
  );
}
