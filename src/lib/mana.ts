/**
 * Compute the converted mana cost (CMC) from a mana cost string.
 *
 * Handles both:
 *   Scryfall format:  {2}{U}{U}  {X}{B}{B}  {W/U}  {2/W}  {0}
 *   Forge format:     2 U U      X B B       W/U    2 W    0
 *
 * X / Y / Z variable costs contribute 0 to CMC (per MTG rules CR 202.3b).
 */
export function computeCmc(manaCost: string): number {
  if (!manaCost || manaCost.trim() === "") return 0;

  const trimmed = manaCost.trim();
  let total = 0;

  if (trimmed.includes("{")) {
    // ── Scryfall / standard {X} notation ────────────────────────
    const tokens = trimmed.match(/\{[^}]+\}/g) ?? [];
    for (const token of tokens) {
      const inner = token.slice(1, -1); // strip braces
      if (/^\d+$/.test(inner)) {
        total += parseInt(inner, 10); // {3} → 3
      } else if (/^[xyzXYZ]$/i.test(inner)) {
        // {X}, {Y}, {Z} → 0
      } else {
        // {W}, {U}, {B}, {R}, {G}, {C}, {S},
        // hybrid {W/U}, {2/W}, Phyrexian {W/P} → each counts as 1
        total += 1;
      }
    }
  } else {
    // ── Forge space-separated notation ──────────────────────────
    // e.g.  "2 U U"  "R"  "X B B"  "W/U"  "0"
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (/^\d+$/.test(token)) {
        total += parseInt(token, 10); // numeric generic
      } else if (/^[xyzXYZ]$/i.test(token)) {
        // X/Y/Z → 0
      } else {
        // single colour letter, hybrid (W/U), snow (S), etc. → 1
        total += 1;
      }
    }
  }

  return total;
}

export type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";

/**
 * Count colored mana pips in a Scryfall mana cost string.
 *
 *  {2}{G}{U}{R}  → G:1, U:1, R:1
 *  {W/U}{W/U}    → W:1, U:1  (each hybrid pip split 0.5 per colour)
 *  {2/W}         → W:1
 *  {W/P}         → W:1  (Phyrexian)
 *  {C}           → C:1  (colourless)
 *  {X}, {2}, …   → ignored
 */
export function countColorPips(manaCost: string): Record<ManaColor, number> {
  const result: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  if (!manaCost || !manaCost.includes("{")) return result;

  const tokens = manaCost.match(/\{[^}]+\}/g) ?? [];
  for (const token of tokens) {
    const inner = token.slice(1, -1);
    if (inner === "C") {
      result.C += 1;
    } else if (/^[WUBRG]$/.test(inner)) {
      result[inner as ManaColor] += 1;
    } else if (inner.includes("/")) {
      // Hybrid: W/U, G/U, 2/W, W/P — collect only colour letters
      const colorParts = inner.split("/").filter((p) => /^[WUBRG]$/.test(p));
      const share = colorParts.length > 0 ? 1 / colorParts.length : 0;
      for (const p of colorParts) result[p as ManaColor] += share;
    }
  }
  return result;
}

/**
 * Sum of generic (numeric) mana costs in a Scryfall mana cost string.
 *
 *  {2}{U}{U}  → 2
 *  {3}{G}     → 3
 *  {X}{B}     → 0  (X is variable, ignored)
 *  {C}{C}     → 0  (colourless pips, not generic)
 */
export function countGenericMana(manaCost: string): number {
  if (!manaCost || !manaCost.includes("{")) return 0;
  const tokens = manaCost.match(/\{[^}]+\}/g) ?? [];
  let total = 0;
  for (const token of tokens) {
    const inner = token.slice(1, -1);
    if (/^\d+$/.test(inner)) total += parseInt(inner, 10);
  }
  return total;
}

/**
 * Returns true if the card type line indicates a land.
 * Handles both array (Manabrew Card.types) and string (Forge Types field).
 */
export function isLand(types: string[] | string | undefined): boolean {
  if (!types) return false;
  if (Array.isArray(types)) return types.some((t) => t.toLowerCase() === "land");
  return types.toLowerCase().includes("land");
}
