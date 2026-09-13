import type { ThemePreset } from "./presets";
import { buildGameColors, type BasePalette } from "./buildGameColors";

const cream = "#e7e2dc";
const primary = "#D4632E";
const secondary = "#713A98";
const accent = "#7ca982";
const charcoal = "#131416";
const cardCharcoal = "#1a1c1d";
const mutedGraphite = "#232627";
const popoverGraphite = "#202223";
const neutralGray = "#343839";
const lightMutedText = "#59615f";
const lightBorder = "#b9bfbd";
const white = "#ffffff";

const palette: BasePalette = {
  foreground: cream,
  labelMuted: accent,
  labelGhost: secondary,
  placeholderFill: charcoal,
  placeholderStroke: accent,
  canvasBackground: charcoal,
  red: "#c93d50",
  redDeep: "#a92f46",
  orange: primary,
  amber: primary,
  yellow: "#d8d34a",
  green: accent,
  teal: "#3fb6b8",
  cyan: "#4cbfd3",
  blue: "#527fbd",
  sky: "#58abd2",
  indigo: "#4c2769",
  violet: "#a85fc5",
  purple: "#71379b",
  pink: "#ce5d82",
  slate: "#7a8180",
  brown: "#ad6848",
  paper: cream,
  poison: "#82ad41",
  promptDefense: "#4f9fd0",
  manaW: "#f8f6d8",
  manaU: "#c1d7e9",
  manaB: "#cac5c0",
  manaR: "#e49977",
  manaG: "#a3c095",
  manaC: "#cac5c0",
};

const preset: ThemePreset = {
  id: "default",
  name: "Manabrew",
  description: "Manabrew default theme",
  light: {
    background: cream,
    foreground: charcoal,
    card: white,
    "card-foreground": charcoal,
    popover: white,
    "popover-foreground": charcoal,
    primary,
    "primary-foreground": charcoal,
    secondary,
    "secondary-foreground": white,
    muted: cream,
    "muted-foreground": lightMutedText,
    accent,
    "accent-foreground": charcoal,
    destructive: "#c93d50",
    "destructive-foreground": white,
    border: lightBorder,
    input: lightBorder,
    ring: primary,
    selection: secondary,
    "selection-foreground": white,
    commander: accent,
    warning: "#806000",
    overlay: "#000000",
  },
  dark: {
    background: charcoal,
    foreground: cream,
    card: cardCharcoal,
    "card-foreground": cream,
    popover: popoverGraphite,
    "popover-foreground": cream,
    primary,
    "primary-foreground": charcoal,
    secondary,
    "secondary-foreground": white,
    muted: mutedGraphite,
    "muted-foreground": cream,
    accent,
    "accent-foreground": charcoal,
    destructive: "#c93d50",
    "destructive-foreground": white,
    border: neutralGray,
    input: neutralGray,
    ring: primary,
    selection: secondary,
    "selection-foreground": white,
    commander: accent,
    warning: "#d8a640",
    overlay: "#000000",
  },
  gameColors: {
    ...buildGameColors(palette),
    cardRing: primary,
    "activeAction.active": primary,
    "playerColors.self": palette.green,
    "playerColors.opponent1": palette.blue,
    "playerColors.opponent2": palette.yellow,
    "playerColors.opponent3": palette.pink,
    "phaseStrip.background": charcoal,
  },
  gameFontSizes: {
    badgeCount: "13px",
    life: "14px",
    manaCount: "11px",
    zoneCount: "14px",
    zoneLabel: "10px",
    avatarInitials: "16px",
  },
};

export default preset;
