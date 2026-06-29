import { Heart, Skull } from "lucide-react";

import { ScryfallImg } from "@/components/ScryfallImg";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useGameStore } from "@/stores/useGameStore";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { getInitials } from "@/components/game/game.utils";
import { useResolveDeckCard } from "./usePromptSourceCard";
import type { CardDto, GameViewDto } from "@/protocol/game";
import type { TargetRef } from "@/protocol";

const SEAT_KEYS = ["self", "opponent1", "opponent2", "opponent3"] as const;
const TARGET_TILE = "h-[123px] w-[88px] shrink-0";

export function PromptTargets({ targets }: { targets: TargetRef[] }) {
  if (targets.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Affects</p>
      <div className="flex flex-wrap items-end gap-2">
        {targets.map((target, index) =>
          target.kind === "player" ? (
            <PromptTargetPlayer key={`player-${target.id}-${index}`} playerId={target.id} />
          ) : (
            <PromptTargetCard key={`card-${target.id}-${index}`} cardId={target.id} />
          ),
        )}
      </div>
    </div>
  );
}

function PromptTargetCard({ cardId }: { cardId: string }) {
  const deckCard = useResolveDeckCard(cardId);
  const gameView = useGameStore((s) => s.gameView);

  if (deckCard) {
    return (
      <ScryfallImg
        src={deckCard.uris.normal}
        alt={deckCard.identity.name}
        className="w-[88px] h-auto self-start object-contain rounded-lg shadow-md shrink-0"
      />
    );
  }

  const name = findCardName(gameView, cardId);
  if (!name) return null;
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-lg border bg-muted p-2 text-center text-xs font-medium",
        TARGET_TILE,
      )}
    >
      {name}
    </span>
  );
}

function PromptTargetPlayer({ playerId }: { playerId: string }) {
  const gameView = useGameStore((s) => s.gameView);
  const themeColors = useTheme().gameTheme;

  const index = gameView?.players.findIndex((p) => p.id === playerId) ?? -1;
  const player = index >= 0 ? gameView?.players[index] : undefined;
  if (!player) {
    return (
      <span
        className={cn(
          "flex items-center justify-center rounded-lg border bg-muted text-sm font-medium",
          TARGET_TILE,
        )}
      >
        PlayerDto
      </span>
    );
  }

  const seatColor = themeColors.playerColors[SEAT_KEYS[index % SEAT_KEYS.length]];
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-lg border bg-card p-2 text-center shadow-md",
        TARGET_TILE,
      )}
      style={{ borderColor: withAlpha(seatColor, 0.55) }}
      title={player.name}
    >
      <Avatar className="h-11 w-11">
        <AvatarFallback className="font-bold text-white" style={{ backgroundColor: seatColor }}>
          {getInitials(player.name)}
        </AvatarFallback>
      </Avatar>
      <span className="line-clamp-1 w-full text-xs font-medium leading-tight">{player.name}</span>
      <span className="flex items-center gap-1 text-sm font-bold tabular-nums">
        <Heart
          className="h-3.5 w-3.5"
          style={{ color: themeColors.life, fill: themeColors.life }}
        />
        {player.life}
      </span>
      {player.poison > 0 && (
        <span
          className="flex items-center gap-0.5 text-[11px] font-semibold tabular-nums"
          style={{ color: themeColors.badges.poison }}
        >
          <Skull className="h-3 w-3" />
          {player.poison}
        </span>
      )}
    </div>
  );
}

function findCardName(
  gameView: GameViewDto | null | undefined,
  cardId: string,
): string | undefined {
  if (!gameView) return undefined;
  const zones: CardDto[] = [
    ...gameView.battlefield,
    ...gameView.players.flatMap((p) => [...p.hand, ...p.graveyard, ...p.exile, ...p.commandZone]),
  ];
  return zones.find((c) => c.id === cardId)?.identity.name;
}
