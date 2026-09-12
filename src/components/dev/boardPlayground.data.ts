import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import { computeCmc } from "@/lib/mana";
import type { ClientCardDto } from "@/stores/gameStore.types";
import type { CombatAssignmentDto, StepKind } from "@/protocol/game";
import type { PlayerHudBadgeFlags } from "@/components/game/panels/playerHudBadges";
import { MANA_LETTERS, type ManaLetter } from "@/themes/gameTheme";

export const PLAYGROUND_PLAYERS = [
  { id: "lab-you", name: "You · Selesnya" },
  { id: "lab-mira", name: "Mira · Dragons" },
  { id: "lab-sol", name: "Sol · Artifacts" },
  { id: "lab-ren", name: "Ren · Graveyard" },
];
export const LOCAL_PLAYER_ID = PLAYGROUND_PLAYERS[0]!.id;
export const PLAYGROUND_SCENARIOS = [
  { id: "opening", label: "Seven-card opening hand" },
  { id: "sparse", label: "Sparse · two players" },
  { id: "crowded", label: "Crowded · Commander pod" },
  { id: "combat", label: "Combat · three defenders" },
  { id: "player-panels", label: "Player panels · four players" },
] as const;
export type PlaygroundScenarioId = (typeof PLAYGROUND_SCENARIOS)[number]["id"];

interface CardSpec {
  name: string;
  types: string[];
  color?: string;
  manaCost?: string;
  power?: string;
  toughness?: string;
  subtypes?: string[];
  keywords?: string[];
}

export const PLAYGROUND_CREATURES: CardSpec[] = [
  {
    name: "Serra Angel",
    types: ["Creature"],
    color: "W",
    manaCost: "{3}{W}{W}",
    power: "4",
    toughness: "4",
    keywords: ["Flying", "Vigilance"],
  },
  {
    name: "Goblin Guide",
    types: ["Creature"],
    color: "R",
    manaCost: "{R}",
    power: "2",
    toughness: "2",
    keywords: ["Haste"],
  },
  {
    name: "Tarmogoyf",
    types: ["Creature"],
    color: "G",
    manaCost: "{1}{G}",
    power: "4",
    toughness: "5",
  },
  {
    name: "Snapcaster Mage",
    types: ["Creature"],
    color: "U",
    manaCost: "{1}{U}",
    power: "2",
    toughness: "1",
  },
  {
    name: "Gravecrawler",
    types: ["Creature"],
    color: "B",
    manaCost: "{B}",
    power: "2",
    toughness: "1",
  },
  {
    name: "Wurmcoil Engine",
    types: ["Artifact", "Creature"],
    manaCost: "{6}",
    power: "6",
    toughness: "6",
    keywords: ["Deathtouch", "Lifelink"],
  },
];
export const PLAYGROUND_LANDS: CardSpec[] = [
  { name: "Forest", types: ["Land"], subtypes: ["Forest"] },
  { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
  { name: "Steam Vents", types: ["Land"], subtypes: ["Island", "Mountain"] },
  { name: "Command Tower", types: ["Land"] },
];
const HAND: CardSpec[] = [
  PLAYGROUND_LANDS[0]!,
  PLAYGROUND_LANDS[1]!,
  PLAYGROUND_LANDS[3]!,
  { name: "Sol Ring", types: ["Artifact"], manaCost: "{1}" },
  { name: "Swords to Plowshares", types: ["Instant"], color: "W", manaCost: "{W}" },
  { name: "Cultivate", types: ["Sorcery"], color: "G", manaCost: "{2}{G}" },
  PLAYGROUND_CREATURES[0]!,
];
const COMMANDERS: CardSpec[] = [
  {
    name: "Trostani, Selesnya's Voice",
    types: ["Creature"],
    color: "WG",
    manaCost: "{G}{G}{W}{W}",
    power: "2",
    toughness: "5",
  },
  {
    name: "Miirym, Sentinel Wyrm",
    types: ["Creature"],
    color: "URG",
    manaCost: "{3}{G}{U}{R}",
    power: "6",
    toughness: "6",
  },
  {
    name: "Breya, Etherium Shaper",
    types: ["Artifact", "Creature"],
    color: "WUBR",
    manaCost: "{W}{U}{B}{R}",
    power: "4",
    toughness: "4",
  },
  {
    name: "Meren of Clan Nel Toth",
    types: ["Creature"],
    color: "BG",
    manaCost: "{2}{B}{G}",
    power: "3",
    toughness: "4",
  },
];
const PARTNER_COMMANDERS: CardSpec[][] = [
  [
    { name: "Sidar Kondo of Jamuraa", types: ["Creature"], color: "WG", manaCost: "{2}{G}{W}" },
    { name: "Tana, the Bloodsower", types: ["Creature"], color: "RG", manaCost: "{2}{R}{G}" },
  ],
  [
    { name: "Kraum, Ludevic's Opus", types: ["Creature"], color: "UR", manaCost: "{3}{U}{R}" },
    { name: "Rograkh, Son of Rohgahh", types: ["Creature"], color: "R", manaCost: "{0}" },
  ],
  [
    {
      name: "Silas Renn, Seeker Adept",
      types: ["Artifact", "Creature"],
      color: "UB",
      manaCost: "{1}{U}{B}",
    },
    { name: "Akiri, Line-Slinger", types: ["Creature"], color: "WR", manaCost: "{R}{W}" },
  ],
  [
    { name: "Reyhan, Last of the Abzan", types: ["Creature"], color: "BG", manaCost: "{1}{B}{G}" },
    {
      name: "Ishai, Ojutai Dragonspeaker",
      types: ["Creature"],
      color: "WU",
      manaCost: "{2}{W}{U}",
    },
  ],
];
const ATTACHMENTS: CardSpec[] = [
  { name: "Sword of Fire and Ice", types: ["Artifact"], subtypes: ["Equipment"], manaCost: "{3}" },
  { name: "Lightning Greaves", types: ["Artifact"], subtypes: ["Equipment"], manaCost: "{2}" },
  { name: "Rancor", types: ["Enchantment"], subtypes: ["Aura"], color: "G", manaCost: "{G}" },
  {
    name: "Ethereal Armor",
    types: ["Enchantment"],
    subtypes: ["Aura"],
    color: "W",
    manaCost: "{W}",
  },
];

export function makePlaygroundCard(
  spec: CardSpec,
  id: string,
  ownerId = LOCAL_PLAYER_ID,
  zoneId = "battlefield",
): ClientCardDto {
  return {
    ...GAME_CARD_DEFAULTS,
    id,
    ownerId,
    controllerId: ownerId,
    zoneId,
    identity: { name: spec.name, setCode: "", cardNumber: "", isToken: false },
    color: spec.color ?? "",
    manaCost: spec.manaCost ?? "",
    types: spec.types,
    subtypes: spec.subtypes ?? [],
    supertypes: ["Forest", "Plains"].includes(spec.name) ? ["Basic"] : [],
    power: spec.power ?? null,
    toughness: spec.toughness ?? null,
    basePower: spec.power ? Number(spec.power) : undefined,
    baseToughness: spec.toughness ? Number(spec.toughness) : undefined,
    cmc: computeCmc(spec.manaCost ?? ""),
    keywords: spec.keywords ?? [],
    counters: {},
    attachmentIds: [],
  };
}

export interface PlaygroundTable {
  scenario: PlaygroundScenarioId;
  players: typeof PLAYGROUND_PLAYERS;
  cards: ClientCardDto[];
  life: Record<string, number>;
  manaPools: Record<string, Partial<Record<ManaLetter, number>>>;
  playerStates: Record<string, Omit<PlayerHudBadgeFlags, "handCount">>;
  commanderDamage: Record<string, Record<string, number>>;
  activePlayerId: string;
  priorityPlayerId: string;
  step: StepKind;
  turn: number;
  blocks: CombatAssignmentDto[];
}

export function createPlaygroundTable(scenario: PlaygroundScenarioId): PlaygroundTable {
  const crowded = scenario === "crowded" || scenario === "combat";
  const playerPanels = scenario === "player-panels";
  const players = PLAYGROUND_PLAYERS.slice(0, crowded || playerPanels ? 4 : 2);
  const cards = HAND.slice(0, scenario === "opening" ? 7 : 5).map((spec, i) =>
    makePlaygroundCard(spec, `lab-hand-${i}`, LOCAL_PLAYER_ID, "hand"),
  );
  const opening = scenario === "opening";
  for (const [seat, player] of players.entries()) {
    const commanders = playerPanels ? PARTNER_COMMANDERS[seat]! : [COMMANDERS[seat]!];
    commanders.forEach((spec, index) =>
      cards.push(
        makePlaygroundCard(
          spec,
          index === 0 ? `${player.id}-commander` : `${player.id}-commander-${index}`,
          player.id,
          "command",
        ),
      ),
    );
    if (opening) continue;
    for (let i = 0; i < (crowded ? 8 : 2); i++) {
      const card = makePlaygroundCard(
        PLAYGROUND_CREATURES[(i + seat) % PLAYGROUND_CREATURES.length]!,
        `${player.id}-creature-${i}`,
        player.id,
      );
      card.tapped = i === 3;
      card.summoningSick = i === 4;
      if (i === 2 && crowded) {
        card.counters = { P1P1: 2 };
        card.power = String(Number(card.power) + 2);
        card.toughness = String(Number(card.toughness) + 2);
      }
      cards.push(card);
    }
    for (let i = 0; i < (crowded ? 9 : 3); i++) {
      const card = makePlaygroundCard(
        PLAYGROUND_LANDS[(i + seat) % PLAYGROUND_LANDS.length]!,
        `${player.id}-land-${i}`,
        player.id,
      );
      card.tapped = i < (crowded ? 5 : 1);
      cards.push(card);
    }
    cards.push(makePlaygroundCard(HAND[4]!, `${player.id}-graveyard-0`, player.id, "graveyard"));
    cards.push(
      makePlaygroundCard(PLAYGROUND_CREATURES[4]!, `${player.id}-exile-0`, player.id, "exile"),
    );
    if (!crowded) continue;
    cards.push(
      makePlaygroundCard(
        {
          name: "Invasion of Zendikar",
          types: ["Battle"],
          subtypes: ["Siege"],
          color: "G",
          manaCost: "{3}{G}",
        },
        `${player.id}-battle`,
        player.id,
      ),
    );
    cards[cards.length - 1]!.counters = { DEFENSE: 3 };
    const parent = cards.find((card) => card.id === `${player.id}-creature-0`)!;
    ATTACHMENTS.forEach((spec, i) => {
      const attachment = makePlaygroundCard(spec, `${player.id}-attachment-${i}`, player.id);
      attachment.attachedTo = parent.id;
      parent.attachmentIds.push(attachment.id);
      cards.push(attachment);
    });
  }
  const blocks: CombatAssignmentDto[] = [];
  if (scenario === "combat") {
    for (let i = 0; i < 6; i++) {
      const attacker = cards.find((card) => card.id === `${LOCAL_PLAYER_ID}-creature-${i}`)!;
      const defender = players[1 + (i % 3)]!;
      attacker.isAttacking = true;
      attacker.attackingPlayerId = defender.id;
      attacker.attackTargetId = defender.id;
      attacker.tapped = !attacker.keywords.includes("Vigilance");
      if (i < 3) blocks.push({ attackerId: attacker.id, blockerId: `${defender.id}-creature-1` });
    }
  }
  return {
    scenario,
    players,
    cards,
    blocks,
    life: Object.fromEntries(
      players.map((player, i) => [player.id, crowded ? [36, 27, 18, 32][i]! : 40]),
    ),
    manaPools: Object.fromEntries(
      players.map((player, seat) => [
        player.id,
        playerPanels
          ? Object.fromEntries(
              MANA_LETTERS.map((letter, index) => [letter, (seat * 2 + index) % 5]),
            )
          : player.id === (scenario === "combat" ? players[2]!.id : LOCAL_PLAYER_ID)
            ? { G: 1, W: 1 }
            : {},
      ]),
    ),
    playerStates: Object.fromEntries(
      players.map((player, seat) => [
        player.id,
        {
          isMonarch: (crowded || playerPanels) && seat === 1,
          hasInitiative: (crowded || playerPanels) && seat === 3,
          poison: playerPanels ? [2, 5, 9, 10][seat]! : crowded && seat === 2 ? 3 : 0,
          energy: playerPanels ? 3 + seat * 2 : 0,
          radiation: playerPanels ? 1 + seat : 0,
          experience: playerPanels ? 4 + seat : crowded && seat === 3 ? 5 : 0,
          ticket: playerPanels ? 2 + seat : 0,
          cityBlessing: playerPanels,
          enduringStory: playerPanels && seat % 2 === 0,
          ringLevel: playerPanels ? 1 + seat : 0,
          speed: playerPanels ? 1 + seat : 0,
        },
      ]),
    ),
    commanderDamage: Object.fromEntries(
      players.map((player, seat) => [
        player.id,
        playerPanels
          ? Object.fromEntries(
              players
                .filter((opponent) => opponent.id !== player.id)
                .flatMap((opponent, index) => [
                  [
                    `${opponent.id}-commander`,
                    index === 0 ? [8, 14, 20, 21][seat]! : 3 + index + seat,
                  ],
                  [`${opponent.id}-commander-1`, 2 + index + seat],
                ]),
            )
          : {},
      ]),
    ),
    activePlayerId: LOCAL_PLAYER_ID,
    priorityPlayerId: scenario === "combat" ? players[2]!.id : LOCAL_PLAYER_ID,
    step: scenario === "combat" ? "combatDeclareBlockers" : "main1",
    turn: opening ? 1 : crowded ? 9 : 3,
  };
}
