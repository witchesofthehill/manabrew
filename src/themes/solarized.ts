import type { ThemePreset } from "./presets";
import { buildGameColors, type BasePalette } from "./buildGameColors";

const palette: BasePalette = {
  foreground: "#93a1a1", // base1
  labelMuted: "#586e75", // base01
  labelGhost: "#839496", // base0
  placeholderFill: "#002b36", // base03
  placeholderStroke: "#073642", // base02
  canvasBackground: "#002b36",
  red: "#dc322f",
  redDeep: "#a62622",
  orange: "#cb4b16",
  amber: "#b58900",
  yellow: "#b58900",
  green: "#859900",
  teal: "#2aa198",
  cyan: "#2aa198",
  blue: "#268bd2",
  sky: "#268bd2",
  indigo: "#6c71c4",
  violet: "#6c71c4",
  purple: "#6c71c4",
  pink: "#d33682",
  slate: "#586e75",
  brown: "#cb4b16",
  paper: "#93a1a1",
  poison: "#657400", // darker olive sibling of solarized green
  promptPass: "#6c71c4", // violet
  promptDefense: "#268bd2", // blue
  manaW: "#eee8d5", // base2
  manaU: "#268bd2",
  manaB: "#073642",
  manaR: "#dc322f",
  manaG: "#859900",
  manaC: "#839496",
};

const preset: ThemePreset = {
  id: "solarized",
  name: "Solarized",
  description: "Ethan Schoonover's precision color scheme",
  light: {
    background: "#fdf6e2",
    foreground: "#073541",
    card: "#fefcf5",
    "card-foreground": "#073541",
    popover: "#fefcf5",
    "popover-foreground": "#073541",
    primary: "#278bd3",
    "primary-foreground": "#fefcf5",
    secondary: "#f0e8d1",
    "secondary-foreground": "#073541",
    muted: "#f1ebda",
    "muted-foreground": "#547a87",
    accent: "#ede4c9",
    "accent-foreground": "#073541",
    destructive: "#dc312e",
    "destructive-foreground": "#fefcf5",
    border: "#dcd4bc",
    input: "#e3dcc9",
    ring: "#278bd3",
    selection: "#6469c4",
    "selection-foreground": "#fefcf5",
    commander: "#b38600",
    warning: "#ca4c16",
    overlay: "#03171c",
  },
  dark: {
    background: "#041e25",
    foreground: "#fdf6e2",
    card: "#082830",
    "card-foreground": "#fdf6e2",
    popover: "#0d2d35",
    "popover-foreground": "#fdf6e2",
    primary: "#3d99db",
    "primary-foreground": "#041e25",
    secondary: "#183339",
    "secondary-foreground": "#fdf6e2",
    muted: "#183339",
    "muted-foreground": "#65909f",
    accent: "#1d3c44",
    "accent-foreground": "#fdf6e2",
    destructive: "#c43331",
    "destructive-foreground": "#fdf6e2",
    border: "#20363c",
    input: "#1d3035",
    ring: "#3d99db",
    selection: "#7277ca",
    "selection-foreground": "#fdf6e2",
    commander: "#cc9900",
    warning: "#d05825",
    overlay: "#010b0e",
  },
  gameColors: buildGameColors(palette),
};

export default preset;
