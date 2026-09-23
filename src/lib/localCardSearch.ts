/**
 * Matching a query against the names a cache holds, which is the only kind of
 * search a name-keyed cache can do.
 *
 * Scryfall does this online, and far better: its operators (`t:creature`,
 * `c:red`, `cmc>=4`, `is:commander`) have no offline equivalent. A query
 * carrying one is refused here rather than answered with something narrower
 * than what was asked for.
 */

/** Scryfall's own query syntax, none of which a list of names can honour. */
const OPERATOR = /[:<>=!]|\b(and|or|not)\b/i;

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * The names whose title contains every word of the query, most exact first.
 * Null when the query is not answerable at all, which keeps a failed search
 * failed instead of quietly emptying it.
 */
export function cachedNameMatches(query: string, names: string[]): string[] | null {
  const trimmed = query.trim();
  if (!trimmed || OPERATOR.test(trimmed)) return null;
  const words = fold(trimmed).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const matches = names.filter((name) => {
    const folded = fold(name);
    return words.every((word) => folded.includes(word));
  });
  const exact = fold(trimmed);
  return matches.sort((a, b) => {
    const rank = (name: string) => {
      const folded = fold(name);
      if (folded === exact) return 0;
      return folded.startsWith(exact) ? 1 : 2;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

/**
 * The one name a misspelling most likely meant, or null when nothing is close
 * enough to guess. What makes pasting a decklist work with no internet.
 */
export function bestCachedName(query: string, names: string[]): string | null {
  const wanted = fold(query.trim());
  if (!wanted) return null;
  let best: { name: string; distance: number } | null = null;
  // A third of the title may be wrong, which covers a typo or a missing accent
  // and stops "bolt" from matching an unrelated card of similar length.
  const limit = Math.max(1, Math.floor(wanted.length / 3));
  for (const name of names) {
    const folded = fold(name);
    if (Math.abs(folded.length - wanted.length) > limit) continue;
    const distance = editDistance(wanted, folded, limit);
    if (distance === null) continue;
    if (!best || distance < best.distance) best = { name, distance };
    if (distance === 0) break;
  }
  return best?.name ?? null;
}

/** Levenshtein, abandoned as soon as every cell is past `limit`, which is what
 *  keeps this a walk over 38k names rather than a full matrix each time. */
function editDistance(a: string, b: string, limit: number): number | null {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let smallest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < smallest) smallest = value;
    }
    if (smallest > limit) return null;
    previous = current;
  }
  const distance = previous[b.length];
  return distance > limit ? null : distance;
}
