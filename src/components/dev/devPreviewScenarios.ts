import type { ClientCardDto } from "@/stores/gameStore.types";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { stationRulesPresentation } from "@/pixi/cardPreview/rulesCardPreviewPresentation";

export type ScryPreviewLayout = "landscape" | "double-sided" | "mixed";

interface PreviewScenario {
  label: string;
  name: string;
  setCode?: string;
  back?: boolean;
  scry?: ScryPreviewLayout[];
}

export const PREVIEW_SCENARIOS: PreviewScenario[] = [
  { label: "Portrait / reminder text", name: "Serra Angel", scry: ["mixed"] },
  { label: "Vanilla / flavor text", name: "Savannah Lions" },
  { label: "Land / mana abilities", name: "Steam Vents" },
  { label: "Artifact creature", name: "Wurmcoil Engine" },
  { label: "Planeswalker / loyalty", name: "Jace, the Mind Sculptor" },
  { label: "Saga / chapters", name: "The Eldest Reborn" },
  { label: "Class / levels", name: "Ranger Class" },
  { label: "Station / Spacecraft thresholds", name: "Lumen-Class Frigate", setCode: "eoe" },
  { label: "Station / Planet threshold", name: "Adagia, Windswept Bastion", setCode: "eoe" },
  { label: "Crew / Vehicle", name: "Smuggler's Copter", setCode: "kld" },
  { label: "Transform DFC", name: "Delver of Secrets", scry: ["double-sided", "mixed"] },
  { label: "Transformed DFC", name: "Delver of Secrets", back: true },
  { label: "Modal DFC", name: "Bala Ged Recovery", scry: ["double-sided", "mixed"] },
  { label: "Modal DFC / land face", name: "Bala Ged Recovery", back: true },
  {
    label: "Battle / landscape front",
    name: "Invasion of Zendikar",
    scry: ["double-sided", "mixed"],
  },
  { label: "Battle / creature back", name: "Invasion of Zendikar", back: true },
  { label: "Split / both halves", name: "Fire // Ice", scry: ["landscape", "mixed"] },
  { label: "Aftermath / both halves", name: "Cut // Ribbons", scry: ["landscape", "mixed"] },
  {
    label: "Room / both doors",
    name: "Roaring Furnace // Steaming Sauna",
    scry: ["landscape", "mixed"],
  },
  { label: "Plane / landscape", name: "Academy at Tolaria West", scry: ["landscape", "mixed"] },
  { label: "Phenomenon / landscape", name: "Spatial Merging" },
  { label: "Scheme / landscape", name: "Your Fate Is Thrice Sealed" },
  { label: "Adventure / two rules sections", name: "Brazen Borrower" },
  { label: "Flip card", name: "Budoka Gardener" },
  { label: "Prototype", name: "Phyrexian Fleshgorger" },
  { label: "Meld", name: "Bruna, the Fading Light" },
  { label: "Long rules / scrolling", name: "Questing Beast" },
  { label: "Face-down / hidden identity", name: "" },
];

export function devPreviewMechanicActions(card: ClientCardDto): HandActionOption[] {
  if (stationRulesPresentation(card.text)) {
    return [
      {
        kind: "ability",
        cardId: card.id,
        actionId: "dev-station",
        label: "Station (tap a 1-power fixture creature)",
      },
    ];
  }
  const crew = /^Crew\s+(\d+)/im.exec(card.text);
  if (card.subtypes.includes("Vehicle") && crew) {
    return [
      {
        kind: "ability",
        cardId: card.id,
        actionId: "dev-crew",
        label: `Crew ${crew[1]}`,
      },
    ];
  }
  return [];
}

export function applyDevPreviewMechanicState(card: ClientCardDto): ClientCardDto {
  const station = card.subtypes.includes("Spacecraft") ? stationRulesPresentation(card.text) : null;
  const vehicle = card.subtypes.includes("Vehicle") && /^Crew\s+\d+/im.test(card.text);
  if (!station && !vehicle) return card;
  const creature = vehicle
    ? card.isCrewed
    : (card.counters.Charge ?? 0) >= Math.max(...station!.tiers.map((tier) => tier.threshold));
  if (card.types.includes("Creature") === creature) return card;
  return {
    ...card,
    types: creature
      ? [...card.types, "Creature"]
      : card.types.filter((type) => type !== "Creature"),
  };
}

export function applyDevPreviewMechanicAction(
  card: ClientCardDto,
  action: HandActionOption,
): ClientCardDto {
  if (action.cardId !== card.id) return card;
  if (action.actionId === "dev-station" && stationRulesPresentation(card.text)) {
    return applyDevPreviewMechanicState({
      ...card,
      counters: { ...card.counters, Charge: (card.counters.Charge ?? 0) + 1 },
    });
  }
  if (action.actionId === "dev-crew" && card.subtypes.includes("Vehicle")) {
    return applyDevPreviewMechanicState({ ...card, isCrewed: true });
  }
  return card;
}
