import horizontalLogoUrl from "/images/brand/logos/color/manabrew-horizontal-header.svg";
import symbolLogoUrl from "/images/brand/logos/color/manabrew-symbol.svg";
import darkHorizontalLogoUrl from "/images/brand/logos/dark/manabrew-horizontal-header-dark.svg";
import darkSymbolLogoUrl from "/images/brand/logos/dark/manabrew-symbol-dark.svg";
import { useTheme as useColorMode } from "next-themes";
import { useThemePreviewMode } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export function ManaBrewLogo({
  variant = "horizontal",
  height = 56,
  className,
}: {
  variant?: "horizontal" | "symbol";
  height?: number;
  className?: string;
}) {
  const { resolvedTheme } = useColorMode();
  const previewMode = useThemePreviewMode();
  const isDark = (previewMode ?? resolvedTheme) !== "light";
  const horizontal = isDark ? darkHorizontalLogoUrl : horizontalLogoUrl;
  const symbol = isDark ? darkSymbolLogoUrl : symbolLogoUrl;
  return (
    <img
      src={variant === "horizontal" ? horizontal : symbol}
      alt="Manabrew"
      width={variant === "horizontal" ? (height * 1450) / 400 : height}
      height={height}
      className={cn("h-auto max-w-full object-contain", className)}
      draggable={false}
    />
  );
}
