import logoSpriteUrl from "/images/brand/logos/interactive/manabrew-logo.svg";
import geometry from "@/assets/brandLogoGeometry.json";
import { useTheme as useColorMode } from "next-themes";
import { useThemePreviewMode } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import "./ManaBrewLogo.css";

export function ManaBrewLogo({
  variant = "horizontal",
  height = 56,
  className,
  decorative = false,
}: {
  variant?: "horizontal" | "symbol";
  height?: number;
  className?: string;
  decorative?: boolean;
}) {
  const { resolvedTheme } = useColorMode();
  const previewMode = useThemePreviewMode();
  const mode = (previewMode ?? resolvedTheme) === "light" ? "light" : "dark";
  const dimensions = geometry[variant][mode];
  return (
    <svg
      viewBox={dimensions.viewBox}
      width={(height * dimensions.width) / dimensions.height}
      height={height}
      className={cn("mb-logo h-auto max-w-full", className)}
      data-mode={mode}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Manabrew"}
      aria-hidden={decorative || undefined}
      focusable="false"
    >
      <use href={`${logoSpriteUrl}#mb-${variant}-${mode}`} />
    </svg>
  );
}
