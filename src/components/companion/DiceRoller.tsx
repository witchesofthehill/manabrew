import { useEffect, useState } from "react";
import { GameIcon } from "./GameIcon";
import { DieShape } from "./DieShape";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCompanionStore } from "@/stores/useCompanionStore";
import { COMPANION_ACCENT_COLORS } from "@/stores/useCompanionStore.constants";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";

/** Resolves the active player's accent colour, falling back to the first
 *  player if none is active and finally `null` (which means use --primary). */
function useActiveAccent(): string | null {
  return useCompanionStore((s) => {
    const session = s.session;
    if (!session) return null;
    const active =
      session.players.find((p) => p.id === session.activePlayerId) ?? session.players[0];
    return active ? COMPANION_ACCENT_COLORS[active.accentKey] : null;
  });
}

const ANIMATION_TICKS = 14;
const ANIMATION_INTERVAL_MS = 90;

type DiceRollerProps =
  | {
      mode?: "first-player";
      open: boolean;
      onOpenChange: (open: boolean) => void;
      players: CompanionPlayer[];
      /** Returns the winning player id (committed to the store). */
      pickWinner: () => string | null;
    }
  | {
      mode: "die";
      open: boolean;
      onOpenChange: (open: boolean) => void;
      /** Number of faces, e.g. 6 / 20 / 100. */
      sides: number;
    }
  | {
      mode: "coin";
      open: boolean;
      onOpenChange: (open: boolean) => void;
    };

export function DiceRoller(props: DiceRollerProps) {
  const title = describeTitle(props);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GameIcon icon="d20" className="size-5" /> {title}
          </DialogTitle>
        </DialogHeader>
        {props.open && <RollBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function describeTitle(props: DiceRollerProps): string {
  if (!("mode" in props) || props.mode === "first-player") return "Randomising first player…";
  if (props.mode === "die") return `Rolling a d${props.sides}…`;
  return "Flipping a coin…";
}

function RollBody(props: DiceRollerProps) {
  if (!("mode" in props) || props.mode === "first-player") {
    return <FirstPlayerAnimation players={props.players} pickWinner={props.pickWinner} />;
  }
  if (props.mode === "die") {
    return <NumericRoll sides={props.sides} />;
  }
  return <CoinFlip />;
}

function FirstPlayerAnimation({
  players,
  pickWinner,
}: {
  players: CompanionPlayer[];
  pickWinner: () => string | null;
}) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (players.length === 0) return;

    let ticks = 0;
    const interval = setInterval(() => {
      ticks += 1;
      const idx = Math.floor(Math.random() * players.length);
      setHighlight(players[idx]!.id);
      if (ticks >= ANIMATION_TICKS) {
        clearInterval(interval);
        const winnerId = pickWinner();
        if (winnerId) {
          setHighlight(winnerId);
          setSettled(true);
        }
      }
    }, ANIMATION_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [players, pickWinner]);

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {players.map((player) => {
          const accent = COMPANION_ACCENT_COLORS[player.accentKey];
          const active = highlight === player.id;
          return (
            <div
              key={player.id}
              className={cn(
                "flex items-center gap-2 rounded-md border-2 p-3 text-sm font-semibold text-white transition",
                active ? "scale-105 border-white" : "border-transparent",
              )}
              style={{ backgroundColor: accent }}
            >
              {player.name}
            </div>
          );
        })}
      </div>
      {settled && highlight && (
        <p className="text-center text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            {players.find((p) => p.id === highlight)?.name}
          </span>{" "}
          goes first.
        </p>
      )}
    </>
  );
}

function NumericRoll({ sides }: { sides: number }) {
  const [value, setValue] = useState(1);
  const [settled, setSettled] = useState(false);
  const accent = useActiveAccent();

  useEffect(() => {
    let ticks = 0;
    const interval = setInterval(() => {
      ticks += 1;
      setValue(1 + Math.floor(Math.random() * sides));
      if (ticks >= ANIMATION_TICKS) {
        clearInterval(interval);
        setSettled(true);
      }
    }, ANIMATION_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sides]);

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <DieShape
        sides={sides}
        value={value}
        settled={settled}
        rolling={!settled}
        accentColor={accent ?? undefined}
      />
      <p className="text-sm text-muted-foreground">
        {settled ? (
          <>
            <span className="font-semibold text-foreground">d{sides}</span> →{" "}
            <span className="font-semibold text-foreground">{value}</span>
          </>
        ) : (
          `d${sides}`
        )}
      </p>
    </div>
  );
}

function CoinFlip() {
  const [value, setValue] = useState<"Heads" | "Tails">("Heads");
  const [settled, setSettled] = useState(false);
  const accent = useActiveAccent();

  useEffect(() => {
    let ticks = 0;
    const interval = setInterval(() => {
      ticks += 1;
      setValue(Math.random() < 0.5 ? "Heads" : "Tails");
      if (ticks >= ANIMATION_TICKS) {
        clearInterval(interval);
        setSettled(true);
      }
    }, ANIMATION_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const borderColor = settled ? (accent ?? "var(--primary)") : "var(--border)";
  const fillColor = settled ? (accent ?? "var(--primary)") : "transparent";

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className={cn(!settled && "animate-companion-die-tumble")}>
        <div
          className="grid size-32 place-items-center rounded-full text-2xl font-black uppercase tracking-wider shadow-lg transition-colors"
          style={{
            borderWidth: 2.5,
            borderStyle: "solid",
            borderColor,
            backgroundColor: fillColor,
            backgroundClip: "border-box",
            color: settled ? "var(--foreground)" : "var(--muted-foreground)",
            backgroundImage: settled
              ? `linear-gradient(${accent ?? "var(--primary)"} 0%, ${accent ?? "var(--primary)"} 100%)`
              : undefined,
          }}
        >
          <span
            className={cn(
              "rounded-full px-3 py-1",
              settled ? "bg-card/70 text-foreground" : "text-muted-foreground",
            )}
          >
            {value === "Heads" ? "H" : "T"}
          </span>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {settled ? (
          <>
            Coin → <span className="font-semibold text-foreground">{value}</span>
          </>
        ) : (
          "Coin"
        )}
      </p>
    </div>
  );
}
