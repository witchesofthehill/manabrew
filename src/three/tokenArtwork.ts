import type { CardDto } from "@manabrew/protocol";
import { arenaCardImageUrl } from "@/three/arenaImageCache";

const assets = import.meta.glob<string>("./assets/tokens/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
});
const sessionSeed = Math.floor(Math.random() * 0xffffffff);

export function tokenArtwork(card: CardDto) {
  if (!card.identity.isToken || card.isFaceDown) return undefined;
  const kind = card.identity.name.toLowerCase().replace(/ token$/, "");
  if (!["food", "clue", "treasure"].includes(kind)) return undefined;
  const options = Object.entries(assets)
    .filter(([path]) => path.includes(`/${kind}-`))
    .sort(([a], [b]) => a.localeCompare(b));
  let hash = sessionSeed;
  for (const letter of `${card.controllerId}:${kind}`) {
    hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619) >>> 0;
  }
  return options[hash % options.length]?.[1];
}

export function duelCardImage(card: CardDto, variant = "large") {
  return tokenArtwork(card) ?? arenaCardImageUrl(card.identity.name, variant);
}
