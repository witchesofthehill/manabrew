import { cn } from "@/lib/utils";

import { DEV_CONTROL_ACTIVE, DEV_CONTROL_BUTTON, DEV_CONTROL_INACTIVE } from "./devPanel.styles";

interface DevToggleButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

export function DevToggleButton({ label, active, onClick }: DevToggleButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        DEV_CONTROL_BUTTON,
        "truncate py-1.5",
        active ? DEV_CONTROL_ACTIVE : DEV_CONTROL_INACTIVE,
      )}
      onClick={onClick}
      title={label}
    >
      {label}
    </button>
  );
}
