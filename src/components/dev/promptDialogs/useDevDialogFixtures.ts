import { CARD_BACK_IMAGE_URL } from "@/components/game/game.constants";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import { useTheme } from "@/hooks/useTheme";
import { useGameStore } from "@/stores/useGameStore";
import type { CardDto, StackObjectDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import type { PromptPresentation } from "@/protocol";
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { PlayerHudSpec } from "@/pixi/hud/playerHud.types";
import type { ClientGameView, ClientPlayerDto } from "@/stores/gameStore.types";

function makeCard(id: string, name: string, power: string, toughness: string): CardDto {
  return {
    ...GAME_CARD_DEFAULTS,
    id,
    identity: { name, setCode: "", cardNumber: "", isToken: false },
    color: "G",
    manaCost: "{2}{G}",
    cmc: 3,
    types: ["Creature"],
    power,
    toughness,
    basePower: Number(power),
    baseToughness: Number(toughness),
    controllerId: "dev-player",
    ownerId: "dev-player",
    text: "Vigilance",
    keywords: ["Vigilance"],
  };
}

const FALLBACK_CARDS = [
  makeCard("dev-card-1", "Serra Angel", "4", "4"),
  makeCard("dev-card-2", "Grizzly Bears", "2", "2"),
  makeCard("dev-card-3", "Llanowar Elves", "1", "1"),
];

const FALLBACK_SOURCE_CARD: DeckCard = {
  identity: { id: "dev-source", name: "Serra Angel", setCode: "", cardNumber: "" },
  uris: {
    small: CARD_BACK_IMAGE_URL,
    normal: CARD_BACK_IMAGE_URL,
    large: CARD_BACK_IMAGE_URL,
    png: CARD_BACK_IMAGE_URL,
    art_crop: CARD_BACK_IMAGE_URL,
    border_crop: CARD_BACK_IMAGE_URL,
  },
  color: "W",
  colorIdentity: ["W"],
  manaCost: "{3}{W}{W}",
  cmc: 5,
  types: ["Creature"],
  subtypes: ["Angel"],
  supertypes: [],
  keywords: ["Flying", "Vigilance"],
  power: "4",
  toughness: "4",
  text: "Flying, vigilance",
};

export const ABILITY_OPTIONS: HandActionOption[] = [
  {
    kind: "ability",
    cardId: "dev-card-1",
    actionId: "dev-ability-1",
    label: "{T}: Add {G}.",
    cost: "{T}",
    isManaAbility: true,
  },
  {
    kind: "ability",
    cardId: "dev-card-1",
    actionId: "dev-ability-2",
    label: "{2}{G}: Put a +1/+1 counter on this creature.",
    cost: "{2}{G}",
  },
];

export const PLAY_OPTIONS: HandActionOption[] = [
  {
    kind: "cast",
    cardId: "dev-card-1",
    actionId: "dev-cast-normal",
    label: "Cast Serra Angel",
    cost: "{3}{W}{W}",
    mode: "normal",
  },
  {
    kind: "cast",
    cardId: "dev-card-1",
    actionId: "dev-cast-alternate",
    label: "Cast for its alternate cost",
    cost: "{2}{W}",
    mode: "alternative",
  },
];

export interface DevDialogFixtures {
  gameView: ClientGameView;
  cards: CardDto[];
  sourceCard: DeckCard;
  me: ClientPlayerDto;
  opponents: ClientPlayerDto[];
  targetPlayer: ClientPlayerDto;
  presentation: PromptPresentation;
  stack: StackObjectDto[];
  cardById: Map<string, CardDto>;
  playerSpec: PlayerHudSpec;
}

export function useDevDialogFixtures(): DevDialogFixtures | null {
  const gameView = useGameStore((state) => state.gameView);
  const gameDecks = useGameStore((state) => state.gameDecks);
  const theme = useTheme().gameTheme;

  if (!gameView || gameView.players.length === 0) return null;

  const visibleCards = [
    ...gameView.battlefield,
    ...gameView.players.flatMap((player) => [
      ...player.hand,
      ...player.graveyard,
      ...player.exile,
      ...player.commandZone,
    ]),
  ];
  const cards = FALLBACK_CARDS.map((fallback, index) => visibleCards[index] ?? fallback);
  const sourceCard =
    Object.values(gameDecks).flatMap((deck) => deck.cards)[0] ?? FALLBACK_SOURCE_CARD;
  const me = gameView.players[0];
  const opponents = gameView.players.slice(1);
  const targetPlayer = opponents[0] ?? me;
  const presentation: PromptPresentation = {
    title: "Choose for Serra Angel",
    description: "Select the option you want to use.",
    text: "Representative prompt text with {W} and {G} mana symbols.",
    targets: [{ kind: "player", id: targetPlayer.id, intent: "friendly" }],
  };
  const stack: StackObjectDto[] =
    gameView.stack.length > 0
      ? gameView.stack
      : cards.slice(0, 2).map((card, index) => ({
          id: `dev-stack-${index}`,
          sourceId: card.id,
          controllerId: index === 0 ? me.id : targetPlayer.id,
          ownerId: index === 0 ? me.id : targetPlayer.id,
          identity: card.identity,
          text: index === 0 ? "Counter target spell." : "Draw two cards.",
          isPermanentSpell: index === 1,
          isCasting: index === 0,
          isDoubleFaced: false,
          faceIndex: 0,
          targets: [],
        }));
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const playerSpec: PlayerHudSpec = {
    playerId: me.id,
    name: me.name,
    isSelf: true,
    life: me.life,
    color: theme.playerColors.self,
    isBot: !me.isHuman,
    isActiveTurn: true,
    isPriorityPlayer: true,
    isTargetable: false,
    isSelectedTarget: false,
    isFlashing: false,
    isEliminated: false,
    isDisconnected: false,
    inCombat: true,
    combatLethal: false,
    manaPool: { W: 2, U: 1, B: 0, R: 0, G: 3, C: 1 },
    badges: [
      {
        id: "hand",
        icon: "card-pickup",
        color: theme.badges.hand,
        label: "Cards in Hand",
        count: 7,
      },
      {
        id: "graveyard",
        icon: "tombstone",
        color: theme.textMuted,
        label: "Graveyard",
        count: 12,
        zone: true,
      },
      { id: "exile", icon: "vortex", color: theme.textMuted, label: "Exile", count: 2, zone: true },
      { id: "monarch", icon: "crown", color: theme.badges.monarch, label: "Monarch" },
      {
        id: "poison",
        icon: "poison-bottle",
        color: theme.badges.poison,
        label: "Poison Counters",
        count: 3,
      },
      {
        id: "cmd-dev",
        icon: "broadsword",
        color: theme.badges.commanderDamage,
        label: "Commander damage",
        count: 8,
      },
    ],
    ruleFacts: [
      { id: "hand-size", label: "Maximum hand size", value: "7" },
      { id: "land-plays", label: "Land plays", value: "1 / 2", emphasized: true },
      { id: "commander-casts", label: "Commander casts", value: "2" },
      { id: "cards-drawn", label: "Cards drawn this turn", value: "1" },
    ],
  };

  return {
    gameView,
    cards,
    sourceCard,
    me,
    opponents,
    targetPlayer,
    presentation,
    stack,
    cardById,
    playerSpec,
  };
}
