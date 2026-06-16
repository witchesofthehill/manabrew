import { Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NoActionProps } from "./internal/types";

export function NoAction({ buttonLayout, label }: NoActionProps) {
  if (buttonLayout === "modern") {
    return (
      <div className="flex w-3/5 flex-col gap-1.5">
        <div className="relative group/no-action">
          <Button
            size="sm"
            variant="outline"
            disabled
            className="h-9 w-full rounded-lg !border-white/20 !bg-white/10 !text-white/70 opacity-30 cursor-default"
            title={label}
          >
            <Hourglass className="h-3.5 w-3.5" />
          </Button>
          {label ? (
            <span className="pointer-events-none absolute left-10 top-full mt-1 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded bg-transparent/80 px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 transition-all duration-150 group-hover/no-action:translate-y-0 group-hover/no-action:opacity-100">
              {label}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled
      className="cursor-default opacity-40"
      title={label}
    >
      <Hourglass className="h-4 w-4" />
    </Button>
  );
}
