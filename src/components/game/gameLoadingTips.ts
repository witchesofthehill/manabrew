import type { KeybindingId } from "@/lib/keybindings";

export const GAME_LOADING_TIP_INTERVAL_MS = 5_000;
export const GAME_LOADING_TIP_TRANSITION_MS = 180;

export type GameLoadingTipAudience = "all" | "desktop" | "touch";

export interface GameLoadingTip {
  readonly id: string;
  readonly text: string;
  readonly audience: GameLoadingTipAudience;
  readonly keybindingIds?: readonly KeybindingId[];
}

export const GAME_LOADING_TIPS: readonly GameLoadingTip[] = [
  {
    id: "show-shortcuts",
    text: "Open the complete shortcut list from anywhere.",
    audience: "desktop",
    keybindingIds: ["show-shortcuts"],
  },
  {
    id: "flip-card",
    text: "Flip a double-faced card while its preview or hand card is focused.",
    audience: "desktop",
    keybindingIds: ["flip-card"],
  },
  {
    id: "toggle-card-view",
    text: "Switch a focused card between its printed face and live rules view.",
    audience: "desktop",
    keybindingIds: ["toggle-card-view"],
  },
  {
    id: "preview-navigation",
    text: "Move between available actions in a focused rules preview.",
    audience: "desktop",
    keybindingIds: ["preview-prev-action", "preview-next-action"],
  },
  {
    id: "preview-activate-action",
    text: "Activate the selected action in a focused rules preview.",
    audience: "desktop",
    keybindingIds: ["preview-activate-action"],
  },
  {
    id: "preview-dismiss",
    text: "Close the current card preview without reaching for the pointer.",
    audience: "desktop",
    keybindingIds: ["preview-dismiss"],
  },
  {
    id: "pass-priority",
    text: "Pass priority or confirm the primary prompt action.",
    audience: "desktop",
    keybindingIds: ["pass-priority"],
  },
  {
    id: "pass-end-of-turn",
    text: "Pass until the end of the turn or let the stack resolve.",
    audience: "desktop",
    keybindingIds: ["pass-end-of-turn"],
  },
  {
    id: "toggle-stack",
    text: "Collapse or expand the stack while keeping the battlefield visible.",
    audience: "desktop",
    keybindingIds: ["toggle-stack"],
  },
  {
    id: "toggle-combat-breakdown",
    text: "Open Combat Breakdown to inspect attackers, blockers, and estimated damage.",
    audience: "desktop",
    keybindingIds: ["toggle-combat-breakdown"],
  },
  {
    id: "toggle-priority-mode",
    text: "Switch between autopass and full control during a game.",
    audience: "desktop",
    keybindingIds: ["toggle-priority-mode"],
  },
  {
    id: "cycle-hand-order",
    text: "Cycle through the available ways to sort your hand.",
    audience: "desktop",
    keybindingIds: ["cycle-hand-order"],
  },
  {
    id: "focus-opponent-field",
    text: "Move focus between opponent battlefields in multiplayer games.",
    audience: "desktop",
    keybindingIds: ["focus-prev-field", "focus-next-field"],
  },
  {
    id: "toggle-fullscreen",
    text: "Toggle fullscreen for a cleaner view of the table.",
    audience: "desktop",
    keybindingIds: ["toggle-fullscreen"],
  },
  {
    id: "live-rules",
    text: "Rules view shows live counters, damage, and current power and toughness.",
    audience: "all",
  },
  {
    id: "player-inspection",
    text: "Select a player plate to inspect their public zones, mana, and status.",
    audience: "all",
  },
  {
    id: "zone-search",
    text: "Zone and stack browsers can search, sort, and filter visible cards.",
    audience: "all",
  },
  {
    id: "hand-order",
    text: "Drag cards within your hand to keep the order that works for you.",
    audience: "all",
  },
  {
    id: "custom-shortcuts",
    text: "Every shortcut can be changed in Preferences under Shortcuts.",
    audience: "all",
  },
  {
    id: "sticky-preview-desktop",
    text: "Right-click a card to keep its preview open while you inspect it.",
    audience: "desktop",
  },
  {
    id: "sticky-preview-touch",
    text: "Long-press a card to keep its preview open without triggering its tap action.",
    audience: "touch",
  },
];
