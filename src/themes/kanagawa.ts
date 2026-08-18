import type { ThemePreset } from "./presets";
import { buildGameColors, type BasePalette } from "./buildGameColors";

const palette: BasePalette = {
  foreground: "#dcd7ba", // fujiWhite
  labelMuted: "#727169", // fujiGray
  labelGhost: "#9e9b93",
  placeholderFill: "#1f1f28", // sumiInk1
  placeholderStroke: "#454658",
  canvasBackground: "#1f1f28",
  red: "#c34043", // autumnRed
  redDeep: "#8b2d30",
  orange: "#dca561", // carpYellow (warm orange-ish)
  amber: "#e6c384", // boatYellow2
  yellow: "#e6c384",
  green: "#76946a", // autumnGreen
  teal: "#7aa89f",
  cyan: "#7fb4ca", // springBlue
  blue: "#7e9cd8", // crystalBlue
  sky: "#7fb4ca",
  indigo: "#957fb8", // oniViolet
  violet: "#957fb8",
  purple: "#957fb8",
  pink: "#d27e99", // sakuraPink
  slate: "#54546d",
  brown: "#dca561",
  paper: "#b8b4d0", // waveAqua2
  poison: "#5a7250", // darker moss sibling of kanagawa green
  promptPass: "#7e9cd8", // crystalBlue
  promptDefense: "#7fb4ca", // springBlue
  manaW: "#dcd7ba",
  manaU: "#7e9cd8",
  manaB: "#454658",
  manaR: "#c34043",
  manaG: "#76946a",
  manaC: "#9e9b93",
};

const preset: ThemePreset = {
  id: "kanagawa",
  name: "Kanagawa",
  description: "Japanese ink-wash inspired, deep indigo and warm accents",
  light: {
    background: "#f0f1f5",
    foreground: "#292d3d",
    card: "#ffffff",
    "card-foreground": "#292d3d",
    popover: "#ffffff",
    "popover-foreground": "#292d3d",
    primary: "#3d66b8",
    "primary-foreground": "#ffffff",
    secondary: "#e1e4ea",
    "secondary-foreground": "#292d3d",
    muted: "#e8eaed",
    "muted-foreground": "#676d83",
    accent: "#dcdfe5",
    "accent-foreground": "#292d3d",
    destructive: "#db2448",
    "destructive-foreground": "#ffffff",
    border: "#cbcfd8",
    input: "#d6dae0",
    ring: "#3d66b8",
    selection: "#8c53c6",
    "selection-foreground": "#ffffff",
    commander: "#dc7a18",
    warning: "#d67a1f",
    overlay: "#101218",
  },
  dark: {
    background: "#181b25",
    foreground: "#c6bfb3",
    card: "#1f222d",
    "card-foreground": "#c6bfb3",
    popover: "#242733",
    "popover-foreground": "#c6bfb3",
    primary: "#6e8ecf",
    "primary-foreground": "#181b25",
    secondary: "#2b2e3b",
    "secondary-foreground": "#c6bfb3",
    muted: "#2b2e3b",
    "muted-foreground": "#6a6e81",
    accent: "#313544",
    "accent-foreground": "#c6bfb3",
    destructive: "#c4314e",
    "destructive-foreground": "#dedad3",
    border: "#303340",
    input: "#2c2f3a",
    ring: "#6e8ecf",
    selection: "#945ec9",
    "selection-foreground": "#dedad3",
    commander: "#da852f",
    warning: "#d2802d",
    overlay: "#08090c",
  },
  gameColors: buildGameColors(palette),
};

export default preset;
