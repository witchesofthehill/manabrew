import { useLayoutEffect } from "react";

export function useVisualViewport(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const update = () => {
      root.style.setProperty(
        "--visual-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      root.style.setProperty(
        "--visual-viewport-width",
        `${viewport?.width ?? window.innerWidth}px`,
      );
      root.style.setProperty("--visual-viewport-top", `${viewport?.offsetTop ?? 0}px`);
      root.style.setProperty("--visual-viewport-left", `${viewport?.offsetLeft ?? 0}px`);
    };
    update();
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      root.style.removeProperty("--visual-viewport-height");
      root.style.removeProperty("--visual-viewport-width");
      root.style.removeProperty("--visual-viewport-top");
      root.style.removeProperty("--visual-viewport-left");
    };
  }, []);
}
