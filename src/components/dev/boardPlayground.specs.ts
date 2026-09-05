import type { CardDto, ZoneDto, ZoneKind } from "@/protocol/game";
import type { BoardCanvasRegion } from "@/pixi/BoardCanvas";
import type { ZoneTileSpec } from "@/pixi/board/BoardZoneTiles";
import type { PlayerHudSpec } from "@/pixi/hud/playerHud.types";
import type { GameThemeColors } from "@/themes/gameTheme";
import { buildCombatRows } from "@/components/game/combatRows";
import { buildPlayerHudBadges, buildZoneBadges } from "@/components/game/panels/playerHudBadges";
import { ZONE_TILE_KEY } from "@/components/game/game.constants";
import { LOCAL_PLAYER_ID, type PlaygroundTable } from "@/components/dev/boardPlayground.data";

export function buildPlaygroundSpecs(
  table: PlaygroundTable,
  theme: GameThemeColors,
  compact: boolean,
  inspect: (card: CardDto) => void,
) {
  const colors = [
    theme.playerColors.self,
    theme.playerColors.opponent1,
    theme.playerColors.opponent2,
    theme.playerColors.opponent3,
  ];
  const colorByPlayer = new Map(table.players.map((player, i) => [player.id, colors[i]!]));
  const battlefield = table.cards.filter((card) => card.zoneId === "battlefield");
  const battlefieldIds = new Set(battlefield.map((card) => card.id));
  const blocks = table.blocks.filter(
    (block) => battlefieldIds.has(block.attackerId) && battlefieldIds.has(block.blockerId),
  );
  const rows = buildCombatRows({
    battlefield,
    combatAssignments: blocks,
    playerIds: table.players.map((player) => player.id),
  });
  const destinationByCard = new Map<string, string>();
  for (const row of rows)
    for (const id of row.attackerIds) destinationByCard.set(id, row.defenderId);
  const regionOf = (card: CardDto): string =>
    destinationByCard.get(card.attachedTo ?? card.id) ?? card.controllerId;
  const regions: BoardCanvasRegion[] = table.players.map((player) => {
    const row = rows.find((entry) => entry.defenderId === player.id);
    return {
      playerId: player.id,
      isLocal: player.id === LOCAL_PLAYER_ID,
      color: colorByPlayer.get(player.id),
      state: {
        cards: battlefield.filter((card) => regionOf(card) === player.id),
        combatRowAttackerIds: row?.attackerIds,
        combatRowBlocks: row?.blocks,
        combatRowGroups: row?.groups.map((group) => ({
          color: colorByPlayer.get(group.controllerId)!,
          label: table.players.find((entry) => entry.id === group.controllerId)!.name,
          attackerIds: group.attackerIds,
        })),
      },
    };
  });
  const zones: ZoneDto[] = [];
  const zoneTiles: Record<string, ZoneTileSpec[]> = {};
  const playerBars: PlayerHudSpec[] = [];
  table.players.forEach((player, seat) => {
    const isSelf = player.id === LOCAL_PLAYER_ID;
    const owned = table.cards.filter((card) => card.ownerId === player.id);
    const handCount = isSelf
      ? owned.filter((card) => card.zoneId === "hand").length
      : table.scenario === "opening"
        ? 7
        : 4 + seat;
    const libraryCount = 100 - owned.length - (isSelf ? 0 : handCount);
    const tiles: ZoneTileSpec[] = [];
    for (const zone of [
      "battlefield",
      "hand",
      "library",
      "graveyard",
      "exile",
      "command",
    ] satisfies ZoneKind[]) {
      const cards = owned.filter((card) => card.zoneId === zone);
      const count = zone === "library" ? libraryCount : zone === "hand" ? handCount : cards.length;
      zones.push({
        zone,
        ownerId: player.id,
        count,
        cards: cards.map((card) => ({ ...card, visibility: "visible" })),
      });
      if (zone === "battlefield" || zone === "hand") continue;
      const topCard = cards[cards.length - 1];
      tiles.push({
        key: ZONE_TILE_KEY[zone],
        label:
          zone === "library"
            ? "Lib"
            : zone === "graveyard"
              ? "GY"
              : zone === "exile"
                ? "EX"
                : "CMD",
        count,
        topCard,
        back: zone === "library",
        commander: zone === "command" ? colors[seat] : undefined,
        commanderTax:
          zone === "command"
            ? table.scenario === "crowded" || table.scenario === "combat"
              ? seat * 2
              : 0
            : undefined,
        onOpen: topCard ? () => inspect(topCard) : undefined,
      });
    }
    zoneTiles[player.id] = compact
      ? tiles.filter((tile) => tile.key === ZONE_TILE_KEY.command)
      : tiles;
    const badges = buildPlayerHudBadges(
      { ...table.playerStates[player.id]!, handCount },
      theme.badges,
    );
    for (const [cardId, damage] of Object.entries(table.commanderDamage[player.id]!)) {
      if (damage <= 0) continue;
      const commander = table.cards.find((card) => card.id === cardId);
      const owner = table.players.find((entry) => entry.id === commander?.ownerId);
      badges.push({
        id: `cmd-${cardId}`,
        icon: "crossed-swords",
        color: owner ? colorByPlayer.get(owner.id)! : theme.badges.commanderDamage,
        label: commander
          ? `Commander damage from ${commander.identity.name}${owner ? ` · ${owner.name}` : ""}`
          : `Commander damage from ${cardId}`,
        count: damage,
        lethal: damage >= 21,
      });
    }
    if (compact) badges.push(...buildZoneBadges(tiles, theme.textMuted));
    playerBars.push({
      playerId: player.id,
      name: player.name,
      isSelf,
      life: table.life[player.id]!,
      color: colors[seat]!,
      isBot: false,
      isActiveTurn: table.activePlayerId === player.id,
      isPriorityPlayer: table.priorityPlayerId === player.id,
      isTargetable: false,
      isSelectedTarget: false,
      isFlashing: false,
      isEliminated: false,
      isDisconnected: false,
      inCombat:
        rows.some((row) => row.defenderId === player.id) ||
        battlefield.some((card) => card.controllerId === player.id && card.isAttacking),
      combatLethal: false,
      manaPool: table.manaPools[player.id]!,
      badges,
    });
  });
  return {
    regions,
    zones,
    zoneTiles,
    playerBars,
    blocks,
    combatFocusIds: rows.map((row) => row.defenderId),
  };
}
