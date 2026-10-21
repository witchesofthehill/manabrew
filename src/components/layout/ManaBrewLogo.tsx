import { useId } from "react";
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
  const dimensions = geometry[variant];
  const mouthId = `mb-mouth-${useId()}`;
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
      <defs>
        <clipPath id={mouthId}>
          <path d={geometry.mouthPath} />
        </clipPath>
      </defs>
      {variant === "horizontal" && <use href={`${logoSpriteUrl}#mb-wordmark`} />}
      <g transform={variant === "horizontal" ? geometry.horizontal.mascotTransform : undefined}>
        <use href={`${logoSpriteUrl}#mb-body-${mode}`} />
        <g className="mb-logo-bubble-ember">
          <use href={`${logoSpriteUrl}#mb-bubble-ember`} />
        </g>
        <g className="mb-logo-bubble-mana">
          <use href={`${logoSpriteUrl}#mb-bubble-mana`} />
        </g>
        <g className="mb-logo-bubble-sage">
          <use href={`${logoSpriteUrl}#mb-bubble-sage`} />
        </g>
        <g className="mb-logo-float-sage">
          <use href={`${logoSpriteUrl}#mb-float-sage`} />
        </g>
        <g className="mb-logo-float-mana">
          <use href={`${logoSpriteUrl}#mb-float-mana`} />
        </g>
        <g className="mb-logo-float-ember">
          <use href={`${logoSpriteUrl}#mb-float-ember`} />
        </g>
        <g className="mb-logo-mouth">
          <use href={`${logoSpriteUrl}#mb-mouth-${mode}`} />
          <g clipPath={`url(#${mouthId})`}>
            <g className="mb-logo-fire-outer">
              <use href={`${logoSpriteUrl}#mb-fire-outer`} />
            </g>
            <g className="mb-logo-fire-core">
              <use href={`${logoSpriteUrl}#mb-fire-core`} />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
