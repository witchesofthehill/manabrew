import type { ThemePreset } from "./presets";
import { buildGameColors, type BasePalette } from "./buildGameColors";

/** Rose Pine palette — muted iris, rose, and pine tones.  The canonical
 *  palette has no dedicated green; a desaturated mint approximation is
 *  used for the buff/p1p1 slot so the whole game stays harmonious. */
const palette: BasePalette = {
  foreground: "#e0def4", // text
  labelMuted: "#6e6a86", // muted
  labelGhost: "#908caa", // subtle
  placeholderFill: "#1f1d2e", // surface
  placeholderStroke: "#26233a", // overlay
  canvasBackground: "#191724", // base
  red: "#eb6f92", // love
  redDeep: "#b04567",
  orange: "#f6c177", // gold
  amber: "#f6c177",
  yellow: "#f6c177",
  green: "#95b1a7", // custom desaturated mint
  teal: "#31748f", // pine
  cyan: "#9ccfd8", // foam
  blue: "#31748f",
  sky: "#9ccfd8",
  indigo: "#c4a7e7", // iris
  violet: "#c4a7e7",
  purple: "#c4a7e7",
  pink: "#ebbcba", // rose
  slate: "#6e6a86",
  brown: "#f6c177",
  paper: "#e0def4",
  poison: "#70978a", // darker mint sibling of rose-pine green
  promptDefense: "#9ccfd8", // foam
  manaW: "#ebbcba",
  manaU: "#31748f",
  manaB: "#403d52",
  manaR: "#eb6f92",
  manaG: "#95b1a7",
  manaC: "#908caa",
};

const preset: ThemePreset = {
  id: "rose-pine",
  name: "Rose Pine",
  description: "Warm, muted tones inspired by Rose Pine",
  light: {
    background: "#faf3eb",
    foreground: "#37344c",
    card: "#fdfdfc",
    "card-foreground": "#37344c",
    popover: "#fdfdfc",
    "popover-foreground": "#37344c",
    primary: "#8b49ab",
    "primary-foreground": "#ffffff",
    secondary: "#ede6de",
    "secondary-foreground": "#37344c",
    muted: "#f0ebe6",
    "muted-foreground": "#716e87",
    accent: "#eae1d7",
    "accent-foreground": "#37344c",
    destructive: "#e2285c",
    "destructive-foreground": "#ffffff",
    border: "#ded7ce",
    input: "#e4ded7",
    ring: "#8b49ab",
    selection: "#9c5eba",
    "selection-foreground": "#ffffff",
    commander: "#f09719",
    warning: "#e69019",
    overlay: "#16151e",
  },
  dark: {
    background: "#1a1825",
    foreground: "#cccbd2",
    card: "#201d2f",
    "card-foreground": "#cccbd2",
    popover: "#232136",
    "popover-foreground": "#cccbd2",
    primary: "#b88dce",
    "primary-foreground": "#1a1825",
    secondary: "#2d2b3b",
    "secondary-foreground": "#cccbd2",
    muted: "#2d2b3b",
    "muted-foreground": "#868494",
    accent: "#333144",
    "accent-foreground": "#cccbd2",
    destructive: "#c4315b",
    "destructive-foreground": "#e4e4e7",
    border: "#323041",
    input: "#2d2b3b",
    ring: "#b88dce",
    selection: "#ab77c5",
    "selection-foreground": "#e4e4e7",
    commander: "#e29b36",
    warning: "#d98e26",
    overlay: "#0b0a10",
  },
  gameColors: buildGameColors(palette),
};

export default preset;
