import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerStore } from "@/stores/useServerStore";
import type { GameFormat } from "@/types/server";
import { cn } from "@/lib/utils";
import {
  Swords,
  Users,
  Loader2,
  Layers,
  Shield,
  Gem,
  Coins,
  Sparkles,
  Wand2,
  Package,
} from "lucide-react";
import { GameIcon } from "@/components/game/GameIcon";

const CommanderIcon = ({ className }: { className?: string }) => (
  <GameIcon name="overlord-helm" className={className} />
);

const FORMATS: {
  value: GameFormat;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  {
    value: "Any",
    label: "Open",
    icon: Sparkles,
    description: "Pick the format at start time — required for draft/sealed",
  },
  {
    value: "Standard",
    label: "Standard",
    icon: Swords,
    description: "60-card constructed, rotating sets",
  },
  {
    value: "Pioneer",
    label: "Pioneer",
    icon: Layers,
    description: "60-card, Return to Ravnica forward",
  },
  { value: "Modern", label: "Modern", icon: Shield, description: "60-card, 8th Edition forward" },
  { value: "Legacy", label: "Legacy", icon: Gem, description: "60-card, all sets, banned list" },
  {
    value: "Vintage",
    label: "Vintage",
    icon: Sparkles,
    description: "60-card, all sets, restricted list",
  },
  { value: "Pauper", label: "Pauper", icon: Coins, description: "60-card, commons only" },
  {
    value: "Commander",
    label: "Commander",
    icon: CommanderIcon,
    description: "100-card singleton, 40 life",
  },
  { value: "Brawl", label: "Brawl", icon: Wand2, description: "60-card singleton, 25 life" },
  {
    value: "Oathbreaker",
    label: "Oathbreaker",
    icon: Wand2,
    description: "60-card singleton, planeswalker cmdr",
  },
  { value: "Sealed", label: "Sealed", icon: Package, description: "40-card limited, sealed pool" },
];

const PLAYER_OPTIONS = [2, 3, 4] as const;

interface CreateRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateRoomDialog({ open, onOpenChange }: CreateRoomDialogProps) {
  const { createRoom, username } = useServerStore();
  const [roomName, setRoomName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [format, setFormat] = useState<GameFormat>("Standard");
  const [creating, setCreating] = useState(false);

  const defaultName = `${username ?? "Player"}'s Room`;

  async function handleCreate() {
    setCreating(true);
    try {
      await createRoom(roomName.trim() || defaultName, maxPlayers, format);
      onOpenChange(false);
      setRoomName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <DialogTitle className="text-lg">Create Room</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Set up a new game room for others to join.
          </DialogDescription>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* Room name */}
          <div className="space-y-1.5">
            <Label htmlFor="room-name" className="text-xs font-medium">
              Room Name
            </Label>
            <Input
              id="room-name"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder={defaultName}
              className="h-9"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>

          {/* Format */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Format</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[240px] overflow-y-auto">
              {FORMATS.map((f) => {
                const Icon = f.icon;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFormat(f.value)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-lg border p-2 text-left transition-colors",
                      format === f.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/30 hover:bg-muted/30",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5",
                          format === f.value ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span className="text-xs font-medium">{f.label}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      {f.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Max players */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Players</Label>
            <div className="flex items-center gap-2">
              {PLAYER_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxPlayers(n)}
                  className={cn(
                    "flex-1 h-10 rounded-lg border flex items-center justify-center gap-1.5 transition-colors",
                    maxPlayers === n
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-primary/30 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Users className="h-3.5 w-3.5" />
                  <span className="text-sm font-medium">{n}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-muted/20 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={creating}
            className="gap-1.5 min-w-[100px]"
          >
            {creating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Swords className="h-3.5 w-3.5" />
            )}
            {creating ? "Creating..." : "Create Room"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
