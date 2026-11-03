import type { SpellbookCombo } from "@/api/commanderSpellbook";
import { platformFetch } from "@/lib/platformFetch";
import { getPlatformType } from "@/platform";

export interface EdhrecComboVote {
  bracket: 2 | 3 | 4;
  voteCount: number;
  controversial: boolean;
  url: string;
}

const COLOR_PATHS: Record<string, string> = {
  "": "colorless",
  C: "colorless",
  W: "mono-white",
  U: "mono-blue",
  B: "mono-black",
  R: "mono-red",
  G: "mono-green",
  UW: "azorius",
  BU: "dimir",
  BR: "rakdos",
  GR: "gruul",
  GW: "selesnya",
  BW: "orzhov",
  RU: "izzet",
  BG: "golgari",
  RW: "boros",
  GU: "simic",
  BUW: "esper",
  BRU: "grixis",
  BGR: "jund",
  GRW: "naya",
  GUW: "bant",
  BGW: "abzan",
  RUW: "jeskai",
  BGU: "sultai",
  BRW: "mardu",
  GRU: "temur",
  BRUW: "yore-tiller",
  BGRU: "glint-eye",
  BGRW: "dune-brood",
  GRUW: "ink-treader",
  BGUW: "witch-maw",
  BGRUW: "five-color",
};

const voteCache = new Map<string, { expires: number; result: Promise<EdhrecComboVote | null> }>();

async function fetchComboVote(path: string, id: string): Promise<EdhrecComboVote | null> {
  const base = getPlatformType() === "tauri" ? "https://json.edhrec.com/pages" : "/edhrec-api";
  const response = await platformFetch(`${base}${path}.json`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`EDHREC request failed (HTTP ${response.status})`);
  const data = await response.json();
  if (data.combo?.combo_id !== id) throw new Error("Unexpected EDHREC combo response");
  const vote = data.combo.comboVote;
  if (vote == null || vote.voteCount === 0) return null;
  const bracket =
    vote.bracket === "any" ? 2 : vote.bracket === "3" ? 3 : vote.bracket === "4-5" ? 4 : null;
  if (
    bracket === null ||
    !Number.isInteger(vote.voteCount) ||
    vote.voteCount < 1 ||
    typeof vote.controversial !== "boolean"
  )
    throw new Error("Invalid EDHREC combo vote");
  return {
    bracket,
    voteCount: vote.voteCount,
    controversial: vote.controversial,
    url: `https://edhrec.com${path}`,
  };
}

export async function fetchComboVotes(combos: SpellbookCombo[]): Promise<{
  votes: Map<string, EdhrecComboVote>;
  unavailable: boolean;
}> {
  const votes = new Map<string, EdhrecComboVote>();
  let unavailable = false;
  const pending = combos.filter((combo) => combo.uses.length <= 2);
  async function worker() {
    for (let combo = pending.pop(); combo; combo = pending.pop()) {
      const color = COLOR_PATHS[combo.identity.split("").sort().join("")];
      const id = combo.id.split("--")[0];
      if (!color || !/^\d+(?:-\d+)?$/.test(id)) continue;
      const path = `/combos/${color}/${id}`;
      let cached = voteCache.get(path);
      if (!cached || cached.expires <= Date.now()) {
        cached = { expires: Date.now() + 86_400_000, result: fetchComboVote(path, id) };
        voteCache.set(path, cached);
      }
      try {
        const vote = await cached.result;
        if (vote) votes.set(combo.id, vote);
      } catch {
        voteCache.delete(path);
        unavailable = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
  return { votes, unavailable };
}
