import { Check } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useCompanionStore } from "@/stores/useCompanionStore";
import {
  COMPANION_LAYOUT_LABELS,
  COMPANION_LAYOUT_OPTIONS,
} from "@/stores/useCompanionStore.constants";
import type { CompanionSession } from "@/stores/useCompanionStore.types";
import { LayoutIcon } from "./LayoutIcon";

export function LayoutMenuItems({ session }: { session: CompanionSession }) {
  const setLayout = useCompanionStore((state) => state.setLayout);
  const layouts = COMPANION_LAYOUT_OPTIONS[session.players.length] ?? ["free" as const];
  return layouts.map((layout) => (
    <DropdownMenuItem
      key={layout}
      onSelect={() => setLayout(layout)}
      className={cn(session.layout === layout && "bg-accent")}
    >
      <LayoutIcon layout={layout} className="size-5" />
      {COMPANION_LAYOUT_LABELS[layout]}
      {session.layout === layout && <Check className="ml-auto" aria-label="Selected" />}
    </DropdownMenuItem>
  ));
}
