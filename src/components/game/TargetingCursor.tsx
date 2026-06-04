import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { TargetingIntent } from "@/types/promptType";
import { useTheme } from "@/hooks/useTheme";
import { INTENT_GLYPH_SVG, ARROW_CURSOR_GLYPH } from "@/pixi/pointerGlyphs";

interface TargetingCursorProps {
  active: boolean;
  intent: TargetingIntent;
  hostile: boolean;
}

/**
 * DOM targeting cursor: a main arrow glyph plus a small intent glyph that
 * follow the pointer. Rendered in a body portal above every modal so the
 * targeting affordance survives zone viewers — unlike the Pixi pointer layer,
 * which is trapped below the modal stacking context. While active it hides the
 * OS cursor everywhere via `targeting-cursor-hidden` on `document.body`.
 */
export function TargetingCursor({ active, intent, hostile }: TargetingCursorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const themeColors = useTheme().gameTheme;

  useEffect(() => {
    if (!active) return;
    const onMove = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      el.style.opacity = "1";
    };
    window.addEventListener("pointermove", onMove);
    document.body.classList.add("targeting-cursor-hidden");
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.body.classList.remove("targeting-cursor-hidden");
    };
  }, [active]);

  if (!active) return null;

  const glyph = INTENT_GLYPH_SVG[intent];
  const glyphColor = hostile ? themeColors.pointer.hostile : themeColors.pointer.friendly;

  return createPortal(
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-[10001] opacity-0"
      style={{ willChange: "transform" }}
    >
      <div
        className="absolute left-0 top-0 text-foreground drop-shadow-md [&>svg]:h-full [&>svg]:w-full"
        style={{ width: 22, height: 22 }}
        dangerouslySetInnerHTML={{ __html: ARROW_CURSOR_GLYPH }}
      />
      {glyph && (
        <div className="absolute" style={{ left: 15, top: 15, width: 26, height: 26 }}>
          <div
            className="targeting-cursor-pulse absolute rounded-full"
            style={{ inset: -7, background: glyphColor, filter: "blur(6px)" }}
          />
          <div
            className="targeting-cursor-float absolute inset-0 text-foreground [&>svg]:h-full [&>svg]:w-full"
            style={{
              filter: `drop-shadow(0 0 3px ${glyphColor}) drop-shadow(0 1px 1px rgba(0,0,0,0.8))`,
            }}
            dangerouslySetInnerHTML={{ __html: glyph }}
          />
        </div>
      )}
    </div>,
    document.body,
  );
}
