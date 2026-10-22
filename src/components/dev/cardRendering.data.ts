import type { ScryfallCardLookup } from "@/stores/useScryfallStore";
import type { ScryfallLanguage } from "@/i18n/locales";

export interface CardRenderingFixture {
  id: string;
  label: string;
  lookup?: ScryfallCardLookup;
  query?: string;
  locale?: ScryfallLanguage;
}

export const CARD_RENDERING_FIXTURES: CardRenderingFixture[] = [
  { id: "white", label: "White / modern", lookup: { name: "Serra Angel", setCode: "m15" } },
  { id: "blue", label: "Blue / modern", lookup: { name: "Negate", setCode: "m15" } },
  { id: "black", label: "Black / modern", lookup: { name: "Sign in Blood", setCode: "m15" } },
  { id: "red", label: "Red / modern", lookup: { name: "Lightning Strike", setCode: "m15" } },
  { id: "green", label: "Green / modern", lookup: { name: "Elvish Mystic", setCode: "m15" } },
  { id: "multicolor", label: "Multicolor", lookup: { name: "Dragonlord Atarka", setCode: "dtk" } },
  { id: "hybrid", label: "Hybrid", lookup: { name: "Kitchen Finks", setCode: "shm" } },
  {
    id: "artifact",
    label: "Artifact creature",
    lookup: { name: "Wurmcoil Engine", setCode: "som" },
  },
  {
    id: "colorless",
    label: "Colorless Eldrazi",
    lookup: { name: "Thought-Knot Seer", setCode: "ogw" },
  },
  { id: "basic-land", label: "Basic land", lookup: { name: "Forest", setCode: "m15" } },
  { id: "dual-land", label: "Two-color land", lookup: { name: "Steam Vents", setCode: "grn" } },
  {
    id: "any-color-land",
    label: "Any-color land",
    lookup: { name: "City of Brass", setCode: "8ed" },
  },
  { id: "retro", label: "Retro frame", lookup: { name: "Counterspell", setCode: "7ed" } },
  {
    id: "alpha-cyclopean-tomb",
    label: "Alpha / Cyclopean Tomb / unprinted cost",
    lookup: { setCode: "lea", collectorNumber: "240" },
  },
  {
    id: "beta-cyclopean-tomb",
    label: "Beta / Cyclopean Tomb",
    lookup: { setCode: "leb", collectorNumber: "241" },
  },
  {
    id: "alpha-orcish-artillery",
    label: "Alpha / Orcish Artillery / printed 1R",
    lookup: { setCode: "lea", collectorNumber: "165" },
  },
  {
    id: "beta-orcish-artillery",
    label: "Beta / Orcish Artillery",
    lookup: { setCode: "leb", collectorNumber: "166" },
  },
  {
    id: "alpha-orcish-oriflamme",
    label: "Alpha / Orcish Oriflamme / printed 1R",
    lookup: { setCode: "lea", collectorNumber: "166" },
  },
  {
    id: "beta-orcish-oriflamme",
    label: "Beta / Orcish Oriflamme",
    lookup: { setCode: "leb", collectorNumber: "167" },
  },
  {
    id: "alpha-drain-life",
    label: "Alpha / Drain Life / printed cost",
    lookup: { setCode: "lea", collectorNumber: "105" },
  },
  {
    id: "beta-drain-life",
    label: "Beta / Drain Life / printed cost",
    lookup: { setCode: "leb", collectorNumber: "106" },
  },
  {
    id: "extended-art",
    label: "Extended art",
    query: '!"Arcane Signet" frame:extendedart unique:prints',
  },
  {
    id: "dfc",
    label: "Transform / both faces",
    lookup: { name: "Delver of Secrets", setCode: "isd" },
  },
  {
    id: "modal-dfc",
    label: "Modal / both faces",
    lookup: { name: "Bala Ged Recovery", setCode: "znr" },
  },
  { id: "split", label: "Split", lookup: { name: "Fire // Ice", setCode: "apc" } },
  { id: "aftermath", label: "Aftermath", lookup: { name: "Cut // Ribbons", setCode: "akh" } },
  { id: "adventure", label: "Adventure", lookup: { name: "Brazen Borrower", setCode: "eld" } },
  {
    id: "prepare",
    label: "Prepare / spell inset",
    lookup: { id: "24f888dd-785c-4089-a89c-03f9080130ed" },
  },
  {
    id: "battle",
    label: "Battle / reverse creature",
    lookup: { name: "Invasion of Zendikar", setCode: "mom" },
  },
  {
    id: "battle-activated",
    label: "Battle / reverse targeted ability",
    lookup: { name: "Invasion of Innistrad", setCode: "mom" },
  },
  { id: "saga", label: "Saga / chapters", lookup: { name: "The Eldest Reborn", setCode: "dom" } },
  {
    id: "saga-merged",
    label: "Saga / merged chapters and reverse creature",
    lookup: { name: "The Modern Age", setCode: "neo" },
  },
  { id: "class", label: "Class / levels", lookup: { name: "Ranger Class", setCode: "afr" } },
  {
    id: "case",
    label: "Case / solved sections",
    lookup: { name: "Case of the Uneaten Feast", setCode: "mkm" },
  },
  {
    id: "suspend",
    label: "Suspend / time counters",
    lookup: { name: "Rift Bolt", setCode: "tsp" },
  },
  {
    id: "class-dice",
    label: "Class / dice abilities",
    lookup: { name: "Barbarian Class", setCode: "afr" },
  },
  {
    id: "station-spacecraft",
    label: "Station / Spacecraft thresholds",
    lookup: { name: "Lumen-Class Frigate", setCode: "eoe" },
  },
  {
    id: "station-planet",
    label: "Station / Planet threshold",
    lookup: { name: "Adagia, Windswept Bastion", setCode: "eoe" },
  },
  {
    id: "crew",
    label: "Crew / Vehicle",
    lookup: { name: "Smuggler's Copter", setCode: "kld" },
  },
  {
    id: "planeswalker",
    label: "Planeswalker / loyalty",
    lookup: { name: "Jace, the Mind Sculptor", setCode: "wwk" },
  },
  {
    id: "planeswalker-static",
    label: "Planeswalker / static ability",
    lookup: { name: "Narset, Parter of Veils", setCode: "war" },
  },
  {
    id: "planeswalker-variable",
    label: "Planeswalker / variable loyalty",
    lookup: { name: "Ugin, the Spirit Dragon", setCode: "frf" },
  },
  { id: "token", label: "Token", lookup: { setCode: "tm19", collectorNumber: "1" } },
  { id: "textless", label: "Textless", query: '!"Lightning Bolt" is:textless unique:prints' },
  { id: "full-art", label: "Full-art land", query: '!"Island" set:unf is:fullart unique:prints' },
  {
    id: "secret-lair",
    label: "Secret Lair / standard Manabrew rendering",
    lookup: { setCode: "sld", collectorNumber: "2125" },
  },
  {
    id: "secret-lair-framed-land",
    label: "Secret Lair / framed land without scan overlay",
    lookup: { setCode: "sld", collectorNumber: "132" },
  },
  {
    id: "poster",
    label: "Poster / original artwork with details",
    lookup: { setCode: "ltr", collectorNumber: "744" },
  },
  {
    id: "long-text",
    label: "Long rules / internal scroll",
    lookup: { name: "Questing Beast", setCode: "eld" },
  },
  {
    id: "localized",
    label: "Localized Italian rules",
    lookup: { name: "Freed from the Real", setCode: "a25" },
    locale: "it",
  },
  {
    id: "room",
    label: "Room / two doors",
    lookup: { name: "Roaring Furnace // Steaming Sauna", setCode: "dsk" },
  },
  {
    id: "prototype",
    label: "Prototype",
    lookup: { name: "Phyrexian Fleshgorger", setCode: "bro" },
  },
  { id: "flip", label: "Kamigawa flip", lookup: { name: "Budoka Gardener", setCode: "chk" } },
  { id: "plane", label: "Plane / landscape", lookup: { name: "Academy at Tolaria West" } },
  { id: "phenomenon", label: "Phenomenon", lookup: { name: "Spatial Merging" } },
  { id: "scheme", label: "Scheme / oversized", lookup: { name: "Your Fate Is Thrice Sealed" } },
  {
    id: "vanguard",
    label: "Vanguard / modifiers",
    lookup: { name: "Akroma, Angel of Wrath Avatar", setCode: "pmoa" },
  },
  {
    id: "vanguard-paper",
    label: "Vanguard / paper",
    lookup: { name: "Serra", setCode: "pvan" },
  },
  { id: "leveler", label: "Level up", lookup: { name: "Student of Warfare", setCode: "roe" } },
  {
    id: "leveler-activated",
    label: "Level up / gained activated abilities",
    lookup: { name: "Enclave Cryptologist", setCode: "roe" },
  },
  { id: "mutate", label: "Mutate", lookup: { name: "Gemrazer", setCode: "iko" } },
  {
    id: "meld",
    label: "Meld / result",
    lookup: { name: "Bruna, the Fading Light", setCode: "emn" },
  },
  {
    id: "starting-town",
    label: "Universes Beyond / gold land",
    lookup: { setCode: "fin", collectorNumber: "289" },
  },
  {
    id: "ashling",
    label: "Commander / unsupported borderless treatment",
    lookup: { setCode: "ecc", collectorNumber: "1" },
  },
];

export const CARD_RENDERING_WIDTHS = [320, 390, 740, 1280] as const;
