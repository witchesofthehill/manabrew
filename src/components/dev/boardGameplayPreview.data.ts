import type { ZoneDto } from "@/protocol/game";
import type { ClientGameView } from "@/stores/gameStore.types";
import { LOCAL_PLAYER_ID, type PlaygroundTable } from "./boardPlayground.data";

export type GameplayPreviewAction =
  | "none"
  | "chooseAction"
  | "chooseAttackers"
  | "chooseBlockers"
  | "payManaCost"
  | "hostile"
  | "friendly";
export type GameplayPreviewModal = "choose-cards" | "scry";

export const GAMEPLAY_PREVIEW_ACTIONS: { id: GameplayPreviewAction; label: string }[] = [
  { id: "none", label: "No prompt" },
  { id: "chooseAction", label: "Priority" },
  { id: "chooseAttackers", label: "Attack" },
  { id: "chooseBlockers", label: "Block" },
  { id: "payManaCost", label: "Payment" },
  { id: "hostile", label: "Hostile targets" },
  { id: "friendly", label: "Friendly targets" },
];

export function playgroundGameView(table: PlaygroundTable, zones: ZoneDto[]): ClientGameView {
  return {
    gameId: "board-playground",
    turn: table.turn,
    step: table.step,
    combatAssignments: table.blocks,
    activePlayerId: table.activePlayerId,
    priorityPlayerId: table.priorityPlayerId,
    players: table.players.map((player) => {
      const cards = (zone: string) =>
        table.cards.filter((card) => card.ownerId === player.id && card.zoneId === zone);
      const flags = table.playerStates[player.id]!;
      return {
        ...player,
        status: "playing",
        isHuman: player.id === LOCAL_PLAYER_ID,
        life: table.life[player.id]!,
        maxHandSize: 7,
        unlimitedHandSize: false,
        landsPlayedThisTurn: 1,
        maxLandPlaysPerTurn: 1,
        unlimitedLandPlays: false,
        cardsDrawnThisTurn: 1,
        damagePrevention: 0,
        isExtraTurn: false,
        extraTurnCount: 0,
        playerKeywords: [],
        commanderCasts: {},
        counters: {
          poison: flags.poison,
          energy: flags.energy,
          radiation: flags.radiation,
          experience: flags.experience,
          ticket: flags.ticket,
        },
        manaPool: table.manaPools[player.id]!,
        commanderDamage: table.commanderDamage[player.id]!,
        hasCityBlessing: flags.cityBlessing,
        hasEnduringStory: flags.enduringStory,
        ringLevel: flags.ringLevel,
        speed: flags.speed,
        hand: cards("hand"),
        graveyard: cards("graveyard"),
        exile: cards("exile"),
        commandZone: cards("command"),
        library: cards("library"),
        libraryCount: 60,
        handCount: cards("hand").length,
        poison: flags.poison,
        energyCounters: flags.energy,
        radiationCounters: flags.radiation,
        experienceCounters: flags.experience,
        ticketCounters: flags.ticket,
      };
    }),
    zones,
    battlefield: table.cards.filter((card) => card.zoneId === "battlefield"),
    stack: [],
    gameOver: false,
    winnerId: null,
    monarchId: table.players.find((player) => table.playerStates[player.id]?.isMonarch)?.id ?? null,
    initiativeHolderId:
      table.players.find((player) => table.playerStates[player.id]?.hasInitiative)?.id ?? null,
    dayTime: "neither",
  };
}
