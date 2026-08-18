import type { ThemePreset } from "./presets";
import { buildGameColors, type BasePalette } from "./buildGameColors";

const palette: BasePalette = {
  foreground: "#ebdbb2", // fg0
  labelMuted: "#928374", // gray
  labelGhost: "#a89984",
  placeholderFill: "#282828", // bg0
  placeholderStroke: "#3c3836", // bg1
  canvasBackground: "#282828",
  red: "#fb4934",
  redDeep: "#cc241d",
  orange: "#fe8019",
  amber: "#fabd2f",
  yellow: "#fabd2f",
  green: "#b8bb26",
  teal: "#8ec07c",
  cyan: "#8ec07c",
  blue: "#83a598",
  sky: "#83a598",
  indigo: "#458588",
  violet: "#d3869b",
  purple: "#d3869b",
  pink: "#d3869b",
  slate: "#928374",
  brown: "#bdae93",
  paper: "#ebdbb2",
  poison: "#98971a", // gruvbox dark-yellow — classic infect olive
  promptPass: "#83a598", // blue
  promptDefense: "#8ec07c", // teal
  manaW: "#ebdbb2",
  manaU: "#83a598",
  manaB: "#3c3836",
  manaR: "#fb4934",
  manaG: "#b8bb26",
  manaC: "#928374",
};

const preset: ThemePreset = {
  id: "gruvbox",
  name: "Gruvbox",
  description: "Retro warm earthy tones",
  light: {
    background: "#fbf3e0",
    foreground: "#292929",
    card: "#fefcf6",
    "card-foreground": "#292929",
    popover: "#fefcf6",
    "popover-foreground": "#292929",
    primary: "#317c5f",
    "primary-foreground": "#fefcf6",
    secondary: "#eae2cd",
    "secondary-foreground": "#292929",
    muted: "#ebe5d6",
    "muted-foreground": "#81705f",
    accent: "#e7dec6",
    "accent-foreground": "#292929",
    destructive: "#c81804",
    "destructive-foreground": "#fefcf6",
    border: "#d5cdb9",
    input: "#ddd6c6",
    ring: "#317c5f",
    selection: "#3a9270",
    "selection-foreground": "#fefcf6",
    commander: "#c7900f",
    warning: "#cf6a17",
    overlay: "#141414",
  },
  dark: {
    background: "#292929",
    foreground: "#f5e6bc",
    card: "#33302e",
    "card-foreground": "#f5e6bc",
    popover: "#383533",
    "popover-foreground": "#f5e6bc",
    primary: "#71af5a",
    "primary-foreground": "#292929",
    secondary: "#403c3a",
    "secondary-foreground": "#f5e6bc",
    muted: "#403c3a",
    "muted-foreground": "#938576",
    accent: "#484441",
    "accent-foreground": "#f5e6bc",
    destructive: "#fa1e05",
    "destructive-foreground": "#f9eed2",
    border: "#46413f",
    input: "#403c3a",
    ring: "#71af5a",
    selection: "#66a550",
    "selection-foreground": "#f9eed2",
    commander: "#edab12",
    warning: "#e67519",
    overlay: "#0f0f0f",
  },
  gameColors: buildGameColors(palette),
};

export default preset;
