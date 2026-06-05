import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompanionStore } from "@/stores/useCompanionStore";
import {
  COMPANION_COUNTER_PRESETS,
  COMPANION_CUSTOM_ICONS,
} from "@/stores/useCompanionStore.constants";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { CompanionIcon } from "./icons";
import { CustomCounterDialog } from "./CustomCounterDialog";

interface AddCounterMenuProps {
  player: CompanionPlayer;
}

export function AddCounterMenu({ player }: AddCounterMenuProps) {
  const addCounter = useCompanionStore((s) => s.addCounter);
  const [customOpen, setCustomOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 rounded-full bg-black/40 text-white hover:bg-black/55 hover:text-white @md:size-8"
            aria-label="Add counter"
          >
            <Plus className="size-4 @md:size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Add counter</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {COMPANION_COUNTER_PRESETS.map((preset) => {
            const already = player.counters.some(
              (c) => c.kind === preset.kind && preset.kind !== "custom",
            );
            return (
              <DropdownMenuItem
                key={preset.kind}
                disabled={already}
                onSelect={() =>
                  addCounter(player.id, {
                    kind: preset.kind,
                    label: preset.label,
                    iconKey: preset.iconKey,
                    value: preset.defaultValue,
                  })
                }
              >
                <CompanionIcon iconKey={preset.iconKey} className="mr-2 size-4" />
                <span>{preset.label}</span>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCustomOpen(true)}>
            <Plus className="mr-2 size-4" aria-hidden />
            Custom counter…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CustomCounterDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        availableIcons={[...COMPANION_CUSTOM_ICONS]}
        onConfirm={(input) => {
          addCounter(player.id, {
            kind: "custom",
            label: input.label,
            iconKey: input.iconKey,
            value: input.value,
          });
          setCustomOpen(false);
        }}
      />
    </>
  );
}
