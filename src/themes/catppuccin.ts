import type { ThemePreset } from "./presets";
import { buildGameColors, type BasePalette } from "./buildGameColors";

const palette: BasePalette = {
  foreground: "#cdd6f4", // text
  labelMuted: "#6c7086", // overlay0
  labelGhost: "#a6adc8", // subtext0
  placeholderFill: "#1e1e2e", // base
  placeholderStroke: "#45475a", // surface1
  canvasBackground: "#1e1e2e",
  red: "#f38ba8", // red
  redDeep: "#a05571",
  orange: "#fab387", // peach
  amber: "#f9e2af", // yellow
  yellow: "#f9e2af",
  green: "#a6e3a1", // green
  teal: "#94e2d5", // teal
  cyan: "#89dceb", // sky
  blue: "#89b4fa", // blue
  sky: "#74c7ec", // sapphire
  indigo: "#b4befe", // lavender
  violet: "#cba6f7", // mauve
  purple: "#cba6f7",
  pink: "#f5c2e7", // pink
  slate: "#6c7086",
  brown: "#fab387",
  paper: "#bac2de", // subtext1
  poison: "#8cc58a", // muted sibling of Catppuccin green
  promptPass: "#cba6f7", // mauve
  promptDefense: "#89b4fa", // blue
  manaW: "#f5e0dc", // rosewater
  manaU: "#89b4fa",
  manaB: "#45475a",
  manaR: "#f38ba8",
  manaG: "#a6e3a1",
  manaC: "#bac2de",
};

const preset: ThemePreset = {
  id: "catppuccin",
  name: "Catppuccin",
  description: "Pastel, soothing warm tones",
  light: {
    background: "#eff1f5",
    foreground: "#404359",
    card: "#ffffff",
    "card-foreground": "#404359",
    popover: "#ffffff",
    "popover-foreground": "#404359",
    primary: "#8839ef",
    "primary-foreground": "#ffffff",
    secondary: "#e0e4eb",
    "secondary-foreground": "#404359",
    muted: "#e7e9ef",
    "muted-foreground": "#6e7187",
    accent: "#dadee7",
    "accent-foreground": "#404359",
    destructive: "#d20f39",
    "destructive-foreground": "#ffffff",
    border: "#cfd4de",
    input: "#d8dce4",
    ring: "#8839ef",
    selection: "#934cf0",
    "selection-foreground": "#ffffff",
    commander: "#eda812",
    warning: "#e0a31f",
    overlay: "#15161e",
  },
  dark: {
    background: "#181825",
    foreground: "#cdd6f4",
    card: "#1e1e2e",
    "card-foreground": "#cdd6f4",
    popover: "#222234",
    "popover-foreground": "#cdd6f4",
    primary: "#b785f4",
    "primary-foreground": "#181825",
    secondary: "#2a2a3c",
    "secondary-foreground": "#cdd6f4",
    muted: "#2a2a3c",
    "muted-foreground": "#5a6caf",
    accent: "#303045",
    "accent-foreground": "#cdd6f4",
    destructive: "#d0254a",
    "destructive-foreground": "#dee4f8",
    border: "#2e2e42",
    input: "#2a2a3c",
    ring: "#b785f4",
    selection: "#a769f2",
    "selection-foreground": "#dee4f8",
    commander: "#ddaa3c",
    warning: "#d29e2d",
    overlay: "#08080c",
  },
  gameColors: buildGameColors(palette),
};

export default preset;
