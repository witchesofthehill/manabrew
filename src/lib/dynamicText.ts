export const DYNAMIC_TEXT_TOKEN = /(\{[^}]+\}(?:\{[^}]+\})*|[+-]\d+\/[+-]\d+)/g;
const PT_MODIFIER = /^[+-]\d+\/[+-]\d+$/;

export function ptModifierTone(text: string): "buffed" | "debuffed" | null {
  return PT_MODIFIER.test(text) ? (text.startsWith("-") ? "debuffed" : "buffed") : null;
}
