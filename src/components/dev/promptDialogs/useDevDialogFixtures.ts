import { resolveCardFaces } from "@/lib/cardFaces";
import { scryfallToSampleGameCard } from "@/lib/sampleGameCard";
import { useTheme } from "@/hooks/useTheme";
import { useGameStore } from "@/stores/useGameStore";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { CardDto, StackObjectDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import type { PromptPresentation } from "@/protocol";
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { PlayerHudSpec } from "@/pixi/hud/playerHud.types";
import type { ClientGameView, ClientPlayerDto } from "@/stores/gameStore.types";
import { PREVIEW_SCENARIOS, type ScryPreviewLayout } from "../devPreviewScenarios";
import { buildDevDialogFixtures } from "@/components/dev/gameplayDialogFixtures";

export async function loadDevScryCards(layout: ScryPreviewLayout): Promise<CardDto[]> {
  const scenarios = PREVIEW_SCENARIOS.filter((scenario) => scenario.scry?.includes(layout));
  return Promise.all(
    scenarios.map(async (scenario, index) => {
      const { info } = await useScryfallStore.getState().getCard({ name: scenario.name });
      const faces = resolveCardFaces(info);
      const face = info.card_faces?.[0];
      return scryfallToSampleGameCard(
        face ? { ...info, ...face, type_line: face.type_line ?? info.type_line } : info,
        {
          id: `dev-scry-${index}`,
          identity: {
            name: info.name,
            setCode: info.set,
            cardNumber: info.collector_number,
            isToken: info.layout.includes("token"),
          },
          isDoubleFaced: faces.isFlippable,
          zoneId: "library",
        },
      );
    }),
  );
}

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

export function useDevDialogFixtures(previewCards?: CardDto[]): DevDialogFixtures | null {
  const gameView = useGameStore((state) => state.gameView);
  const gameDecks = useGameStore((state) => state.gameDecks);
  const theme = useTheme().gameTheme;

  return buildDevDialogFixtures(
    gameView,
    Object.values(gameDecks).flatMap((deck) => deck.cards),
    theme,
    previewCards,
  );
}
