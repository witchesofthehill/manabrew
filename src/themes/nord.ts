import type { ThemePreset } from "./presets";
import { buildGameColors, type BasePalette } from "./buildGameColors";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
/** Nord aurora + frost + polar night hues, mapped to the shared game token
 *  schema. Dark-theme values — light mode currently piggy-backs on these
 *  for the game surface since the game is always rendered against the
 *  Pixi canvas background which is part of the theme. */
const palette: BasePalette = {
  foreground: "#eceff4", // snow storm
  labelMuted: "#4c566a", // polar night 4
  labelGhost: "#6f7b93",
  placeholderFill: "#2e3440", // polar night 0
  placeholderStroke: "#434c5e", // polar night 2
  canvasBackground: "#2e3440",
  red: "#bf616a", // aurora red
  redDeep: "#8b3d44",
  orange: "#d08770", // aurora orange
  amber: "#ebcb8b", // aurora yellow
  yellow: "#ebcb8b",
  green: "#a3be8c", // aurora green
  teal: "#8fbcbb", // frost 0
  cyan: "#88c0d0", // frost 1
  blue: "#5e81ac", // frost 3
  sky: "#81a1c1", // frost 2
  indigo: "#5e81ac",
  violet: "#b48ead", // aurora purple
  purple: "#b48ead",
  pink: "#d08770",
  slate: "#4c566a",
  brown: "#d08770",
  paper: "#d8dee9", // snow storm 0
  poison: "#8b9d6f", // darker olive sibling of aurora green
  promptPass: "#5e81ac", // frost 3 — pass priority
  promptDefense: "#88c0d0", // frost 1 — declare blockers
  manaW: "#eceff4",
  manaU: "#81a1c1",
  manaB: "#434c5e",
  manaR: "#bf616a",
  manaG: "#a3be8c",
  manaC: "#d8dee9",
};
const preset: ThemePreset = {
  id: "nord",
  name: "Nord",
  get description() {
    return i18n._(msg`Arctic, cool blue-grey palette`);
  },
  light: {
    background: "#f3f4f6",
    foreground: "#2f3541",
    card: "#ffffff",
    "card-foreground": "#2f3541",
    popover: "#ffffff",
    "popover-foreground": "#2f3541",
    primary: "#5d81ac",
    "primary-foreground": "#ffffff",
    secondary: "#e1e4ea",
    "secondary-foreground": "#2f3541",
    muted: "#e7eaee",
    "muted-foreground": "#6a7181",
    accent: "#dcdfe5",
    "accent-foreground": "#2f3541",
    destructive: "#be6069",
    "destructive-foreground": "#ffffff",
    border: "#d0d4dd",
    input: "#d9dce3",
    ring: "#5d81ac",
    selection: "#5e8fc9",
    "selection-foreground": "#ffffff",
    commander: "#d99d26",
    warning: "#d29b2d",
    overlay: "#111318",
  },
  dark: {
    background: "#1a1d23",
    foreground: "#d8dee9",
    card: "#20242c",
    "card-foreground": "#d8dee9",
    popover: "#242932",
    "popover-foreground": "#d8dee9",
    primary: "#89a3c2",
    "primary-foreground": "#1a1d23",
    secondary: "#2b303b",
    "secondary-foreground": "#d8dee9",
    muted: "#2b303b",
    "muted-foreground": "#717f98",
    accent: "#313844",
    "accent-foreground": "#d8dee9",
    destructive: "#b54a55",
    "destructive-foreground": "#e5e9f0",
    border: "#2f3541",
    input: "#2b303b",
    ring: "#89a3c2",
    selection: "#6694cc",
    "selection-foreground": "#e5e9f0",
    commander: "#d7a542",
    warning: "#cc9933",
    overlay: "#090a0c",
  },
  gameColors: buildGameColors(palette),
};
export default preset;
