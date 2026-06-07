// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Semantic classification of a targeting choice. The UI uses this to pick a
 * pointer icon and the per-intent glow color. Combat intents (`attack`,
 * `block`) keep the classic arrow; everything else is rendered as a
 * floating pointer.
 *
 * Mirrors the `TargetingIntent` enum in
 * `forge-engine/crates/forge-agent-interface/src/game_view_dto.rs`. The
 * canonical wire-format description is in `docs/PROTOCOL.md` §5.4.
 */
export const TargetingIntent = {
  Damage: "damage",
  Destroy: "destroy",
  Sacrifice: "sacrifice",
  Exile: "exile",
  Bounce: "bounce",
  Mill: "mill",
  Discard: "discard",
  Counter: "counter",
  Tap: "tap",
  Untap: "untap",
  Copy: "copy",
  Buff: "buff",
  Debuff: "debuff",
  Heal: "heal",
  LoseLife: "loseLife",
  Reveal: "reveal",
  Draw: "draw",
  GainControl: "gainControl",
  Fight: "fight",
  Attach: "attach",
  Attack: "attack",
  Block: "block",
  Hostile: "hostile",
  Friendly: "friendly",
} as const;

export type TargetingIntent = (typeof TargetingIntent)[keyof typeof TargetingIntent];

/** Intents that should be rendered as arrows rather than floating pointer
 *  glyphs. Combat declarations (`attack` / `block`) get the painterly
 *  treatment; `attach` (Equipment / Aura targeting) gets the rune
 *  treatment — both convey a persistent relationship better than a
 *  cursor-anchored icon. */
export function intentPrefersArrow(intent: TargetingIntent): boolean {
  return (
    intent === TargetingIntent.Attack ||
    intent === TargetingIntent.Block ||
    intent === TargetingIntent.Attach
  );
}

/**
 * Classify a `TargetingIntent` as hostile (acting against the target) or
 * friendly (supporting / informing). The pointer palette has only two
 * colours (`pointer.hostile` / `pointer.friendly`) — the icon glyph
 * carries the specific semantic; colour only signals the valence.
 *
 * Mirrors `TargetingIntent::is_hostile` in
 * `forge-agent-interface/src/game_view_dto.rs` so engine and UI stay in
 * sync if a new intent is added.
 */
export function intentIsHostile(intent: TargetingIntent): boolean {
  // Keep in lock-step with Rust `TargetingIntent::is_hostile` in
  // `forge-agent-interface/src/game_view_dto.rs`. `Attack` / `Block`
  // are combat intents rendered as arrows, not pointers, so they stay
  // out of this classifier on both sides of the wire.
  switch (intent) {
    case TargetingIntent.Damage:
    case TargetingIntent.Destroy:
    case TargetingIntent.Sacrifice:
    case TargetingIntent.Exile:
    case TargetingIntent.Bounce:
    case TargetingIntent.Mill:
    case TargetingIntent.Discard:
    case TargetingIntent.Counter:
    case TargetingIntent.Tap:
    case TargetingIntent.Debuff:
    case TargetingIntent.LoseLife:
    case TargetingIntent.GainControl:
    case TargetingIntent.Fight:
    case TargetingIntent.Hostile:
      return true;
    default:
      return false;
  }
}
