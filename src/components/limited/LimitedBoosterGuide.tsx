import { useEffect, useId, useRef } from "react";
import { gsap } from "@/pixi/effects/gsap";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export function LimitedBoosterGuide() {
  const glow = useRef<SVGGElement>(null);
  const glowId = useId();
  const animate = usePreferencesStore((preferences) => preferences.inGameAnimations);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let motion: gsap.Context | undefined;
    const update = () => {
      motion?.revert();
      const cluster = glow.current;
      if (!animate || media.matches || !cluster) return;
      motion = gsap.context(() => {
        gsap.fromTo(
          cluster,
          { x: 0 },
          {
            x: 70,
            duration: 1.5,
            repeat: -1,
            repeatDelay: 0.45,
            ease: "power1.inOut",
          },
        );
        gsap.fromTo(
          cluster.querySelectorAll("[data-booster-sparkle]"),
          { opacity: 0.25, scale: 0.65, transformOrigin: "50% 50%" },
          {
            opacity: 1,
            scale: 1.15,
            duration: 0.65,
            stagger: 0.2,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
          },
        );
      }, glow);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
      motion?.revert();
    };
  }, [animate]);
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      className="pointer-events-none absolute left-0 top-[24%] h-8 w-full -translate-y-1/2 overflow-visible text-primary"
    >
      <defs>
        <filter id={glowId} x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      <path
        d="M3 10H97"
        stroke="currentColor"
        strokeWidth="7"
        strokeDasharray="0.1 5"
        strokeLinecap="round"
        opacity="0.35"
        filter={`url(#${glowId})`}
      />
      <path
        d="M3 10H97"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeDasharray="0.1 5"
        strokeLinecap="round"
      />
      <g ref={glow}>
        <circle cx="15" cy="10" r="3" fill="currentColor" filter={`url(#${glowId})`} />
        {[
          { x: 15, y: 10, size: 1 },
          { x: 8, y: 6, size: 0.55 },
          { x: 22, y: 14, size: 0.65 },
        ].map(({ x, y, size }) => (
          <g key={x} transform={`translate(${x} ${y}) scale(${size})`}>
            <g data-booster-sparkle opacity="0.75">
              <path
                d="M0-4Q0-0.8 3 0Q0.8 0 0 4Q0 0.8-3 0Q-0.8 0 0-4Z"
                fill="currentColor"
                filter={`url(#${glowId})`}
              />
              <path d="M0-4Q0-0.8 3 0Q0.8 0 0 4Q0 0.8-3 0Q-0.8 0 0-4Z" fill="var(--foreground)" />
            </g>
          </g>
        ))}
      </g>
    </svg>
  );
}
