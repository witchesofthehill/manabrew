import type { ForgeDeck } from "@manabrew/forge-wasm";

export const duelDecks: (ForgeDeck & { colorIdentity: string[] })[] = [
  {
    name: "Dawn Patrol",
    colorIdentity: ["W"],
    format: "Legacy",
    cards: [
      { name: "Plains", count: 24 },
      ...[
        "Savannah Lions",
        "Elite Vanguard",
        "Silvercoat Lion",
        "Youthful Knight",
        "Traveling Philosopher",
        "Serra Angel",
        "Oreskos Swiftclaw",
        "Standing Troops",
        "Trained Caracal",
      ].map((name) => ({ name, count: 4 })),
    ],
  },
  {
    name: "Wildwood",
    colorIdentity: ["G"],
    format: "Legacy",
    cards: [
      { name: "Forest", count: 24 },
      ...[
        "Llanowar Elves",
        "Grizzly Bears",
        "Runeclaw Bear",
        "Centaur Courser",
        "Giant Spider",
        "Craw Wurm",
        "Colossal Dreadmaw",
        "Elvish Warrior",
        "Garruk's Companion",
      ].map((name) => ({ name, count: 4 })),
    ],
  },
];
