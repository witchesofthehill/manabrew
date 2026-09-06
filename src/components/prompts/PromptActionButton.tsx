import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useIsMobileGame, useIsTouch } from "@/hooks/useBreakpoints";
import { cn } from "@/lib/utils";
import { getPromptActionButtonStyle, usePromptActionColors } from "./internal/promptActionTheme";

interface PromptActionButtonProps {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  variant?: "default" | "outline" | "secondary";
  baseColor?: string;
  style?: CSSProperties;
  badge?: string;
}

export function PromptActionButton({
  label,
  icon,
  onClick,
  disabled,
  title,
  className,
  variant = "default",
  baseColor,
  style,
  badge,
}: PromptActionButtonProps) {
  const promptActionColors = usePromptActionColors();
  const minimal = useIsMobileGame();
  const isTouch = useIsTouch();
  // Any coarse pointer can't reach the hover tooltip, so show the label inline.
  const showLabel = minimal || isTouch;
  const resolvedBaseColor = baseColor ?? promptActionColors.passAction;
  const themedStyle = {
    ...getPromptActionButtonStyle(resolvedBaseColor),
    ...style,
  };

  return (
    <div className="relative group/action">
      <Button
        size="icon"
        variant={variant}
        className={cn(
          "min-h-9 min-w-9 pointer-coarse:min-h-10 pointer-coarse:min-w-10 rounded-lg p-0 shrink-0 !border-0 transition-[filter,box-shadow] hover:brightness-105",
          showLabel && "w-auto pointer-coarse:w-auto px-1.5",
          className,
        )}
        onClick={onClick}
        disabled={disabled}
        title={title ?? label}
        style={themedStyle}
      >
        {showLabel ? (
          <span className="flex flex-col items-center gap-0.5">
            {icon}
            <span className="text-[8px] font-bold uppercase leading-none tracking-wide">
              {label}
            </span>
          </span>
        ) : (
          icon
        )}
      </Button>
      {badge != null && (
        <span className="pointer-events-none absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/80 px-1 text-[9px] font-bold text-white">
          {badge}
        </span>
      )}
      {!showLabel && (
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-7 whitespace-nowrap rounded bg-black/80 px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 group-hover/action:opacity-100 transition-opacity">
          {label}
        </span>
      )}
    </div>
  );
}
