import { Check, ChevronDown, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { FormatBadge } from "@/components/game/FormatBadge";
import { FORMATS, PLAYER_OPTIONS_MATCH } from "@/components/lobby/tableSetup.constants";
import { cn } from "@/lib/utils";
import type { GameFormat } from "@/types/server";
interface TableSetupGameCardProps {
  format: GameFormat;
  onFormatChange: (format: GameFormat) => void;
  maxPlayers: number;
  onMaxPlayersChange: (maxPlayers: number) => void;
}
export function TableSetupGameCard({
  format,
  onFormatChange,
  maxPlayers,
  onMaxPlayersChange,
}: TableSetupGameCardProps) {
  const selectedFormat = FORMATS.find((option) => option.value === format);
  return (
    <section className="rounded-xl border bg-card/85 p-4 backdrop-blur-md">
      <h2 className="text-ui-label font-semibold">The game</h2>
      <div className="mt-3 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-ui-label font-medium">Format</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                id="room-format"
                title="Change format"
                className="inline-flex w-full cursor-pointer items-center gap-1.5 rounded-full border bg-background/60 px-2 py-1 text-ui-label backdrop-blur-sm transition-colors hover:bg-background/80 touch:min-h-11 touch:min-w-11 whitespace-normal"
              >
                <FormatBadge formatId={format.toLowerCase()} />
                <span className="font-medium">{selectedFormat?.label}</span>
                <ChevronDown className="ml-auto h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
            >
              {FORMATS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => onFormatChange(option.value)}
                  className="gap-2"
                >
                  <FormatBadge formatId={option.value.toLowerCase()} />
                  <span className="text-ui-label">{option.label}</span>
                  {format === option.value && (
                    <Check className="ml-auto h-3 w-3 text-selection-border" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="text-ui-meta text-muted-foreground">{selectedFormat?.description}</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-ui-label font-medium">Players</Label>
          <div className="flex items-center gap-2">
            {PLAYER_OPTIONS_MATCH.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onMaxPlayersChange(n)}
                className={cn(
                  "flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border transition-colors touch:min-h-11 touch:min-w-11 text-ui-label whitespace-normal",
                  maxPlayers === n
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
                )}
              >
                <Users className="h-3.5 w-3.5" />
                <span className="text-ui-label font-medium">{n}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
