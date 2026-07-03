import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
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
}: PromptActionButtonProps) {
  const promptActionColors = usePromptActionColors();
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
          "!h-9 !w-9 min-h-9 min-w-9 rounded-lg p-0 shrink-0 !border-0 !text-white transition-[filter,box-shadow] hover:brightness-105",
          className,
        )}
        onClick={onClick}
        disabled={disabled}
        title={title ?? label}
        style={themedStyle}
      >
        {icon}
      </Button>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-7 whitespace-nowrap rounded bg-black/80 px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 group-hover/action:opacity-100 transition-opacity">
        {label}
      </span>
    </div>
  );
}
