export type DevDialogPreview =
  | "choose-boolean"
  | "choose-color"
  | "choose-colors"
  | "choose-number-buttons"
  | "choose-number-input"
  | "choose-cards"
  | "reveal-cards"
  | "scry"
  | "reorder"
  | "choose-selection"
  | "assign-combat-damage"
  | "damage-order"
  | "dice-roll"
  | "dice-roll-contest"
  | "ability-picker"
  | "play-mode-picker"
  | "zone-viewer"
  | "spell-stack"
  | "target-spell-stack"
  | "board-settings"
  | "concede-game"
  | "leave-game"
  | "eliminated-player"
  | "eliminated-host"
  | "player-details"
  | "combat-summary"
  | "game-over";

interface DevDialogPreviewOption {
  id: DevDialogPreview;
  label: string;
  description: string;
}

interface DevDialogPreviewGroup {
  label: string;
  options: DevDialogPreviewOption[];
}

export const DEV_DIALOG_PREVIEW_GROUPS: DevDialogPreviewGroup[] = [
  {
    label: "Prompt dialogs",
    options: [
      { id: "choose-boolean", label: "Confirm choice", description: "Yes or no decision" },
      { id: "choose-color", label: "Choose color", description: "Single mana color" },
      { id: "choose-colors", label: "Choose colors", description: "Repeated color allocation" },
      { id: "choose-number-buttons", label: "Choose number", description: "Short numeric range" },
      { id: "choose-number-input", label: "Enter number", description: "Wide numeric range" },
      { id: "choose-cards", label: "Choose cards", description: "Selectable card row" },
      { id: "reveal-cards", label: "Reveal cards", description: "Informational card row" },
      { id: "scry", label: "Scry", description: "Drag cards between zones" },
      { id: "reorder", label: "Reorder cards", description: "Drag cards into order" },
      { id: "choose-selection", label: "Choose options", description: "Weighted repeatable list" },
      {
        id: "assign-combat-damage",
        label: "Assign damage",
        description: "Combat damage allocation",
      },
      { id: "damage-order", label: "Damage order", description: "Order multiple blockers" },
      { id: "dice-roll", label: "Dice result", description: "Single animated result" },
      { id: "dice-roll-contest", label: "Dice contest", description: "Labeled player results" },
    ],
  },
  {
    label: "Battlefield dialogs",
    options: [
      { id: "ability-picker", label: "Ability picker", description: "Card ability choices" },
      { id: "play-mode-picker", label: "Play mode", description: "Cast and alternate modes" },
      { id: "zone-viewer", label: "Zone viewer", description: "Cards with target states" },
      { id: "spell-stack", label: "Spell stack", description: "Read-only stack browser" },
      {
        id: "target-spell-stack",
        label: "Target spell",
        description: "Targetable stack entries",
      },
      { id: "board-settings", label: "Board settings", description: "In-game preferences" },
      { id: "concede-game", label: "Concede", description: "Concede confirmation" },
      { id: "leave-game", label: "Host leave", description: "End-game warning" },
      { id: "eliminated-player", label: "Eliminated", description: "Observe or leave" },
      { id: "eliminated-host", label: "Eliminated host", description: "Observe-only variant" },
      { id: "player-details", label: "Player details", description: "Resources and rule state" },
      { id: "combat-summary", label: "Combat summary", description: "Combat breakdown" },
    ],
  },
  {
    label: "Full-screen states",
    options: [{ id: "game-over", label: "Game over", description: "Winning game result" }],
  },
];
