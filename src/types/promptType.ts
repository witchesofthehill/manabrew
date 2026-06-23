// SPDX-License-Identifier: GPL-3.0-or-later

import type { TargetingIntent as ProtocolTargetingIntent } from "@/protocol";

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
} as const satisfies Record<string, ProtocolTargetingIntent>;

export type TargetingIntent = ProtocolTargetingIntent;

export function intentPrefersArrow(intent: TargetingIntent): boolean {
  return (
    intent === TargetingIntent.Attack ||
    intent === TargetingIntent.Block ||
    intent === TargetingIntent.Attach
  );
}

export function intentIsHostile(intent: TargetingIntent): boolean {
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
