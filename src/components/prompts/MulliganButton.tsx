/**
 * Shared button shell for the mulligan prompt-action slot. Keeps the
 * sizing, typography, and themed-shadow styling identical across
 * `Mulligan.tsx` (Keep / Mulligan) and `MulliganPutBack.tsx` (Confirm)
 * so the two prompts feel like one continuous flow, and any future
 * tweak to the visual lands in a single place.
 */
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { getPromptActionButtonStyle } from "@/components/prompts/internal/promptActionTheme";

const BUTTON_CLASSNAME =
  "h-9 w-full rounded-lg text-sm font-black tracking-[0.08em] !border-0 !text-white transition-[filter,box-shadow] hover:brightness-105 flex items-center justify-center gap-2";

interface MulliganButtonProps {
  /** Base color from the prompt-action theme (e.g. defenseAction). */
  color: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

export function MulliganButton({ color, label, icon, onClick, disabled }: MulliganButtonProps) {
  return (
    <Button
      size="sm"
      variant="default"
      className={BUTTON_CLASSNAME}
      onClick={onClick}
      disabled={disabled}
      style={getPromptActionButtonStyle(color)}
    >
      {icon}
      {label}
    </Button>
  );
}
