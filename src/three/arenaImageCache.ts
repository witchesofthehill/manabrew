const warmed = new Set<string>();
const pending = new Set<string>();
const queue: string[] = [];
let running = 0;

export const arenaCardImageUrl = (name: string, variant: string) =>
  `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=${variant}`;

function pump() {
  while (running < 2 && queue.length) {
    const url = queue.shift()!;
    running++;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.fetchPriority = "low";
    let finished = false;
    const finish = (success: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      image.onload = image.onerror = null;
      pending.delete(url);
      if (success) warmed.add(url);
      window.setTimeout(() => {
        running--;
        pump();
      }, 150);
    };
    const timeout = window.setTimeout(() => finish(false), 15000);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  }
}

export function warmArenaDeckImages(names: (string | undefined)[]) {
  for (const variant of ["large", "art_crop"]) {
    for (const name of new Set(names)) {
      if (!name || name === "Hidden Card") continue;
      const url = arenaCardImageUrl(name, variant);
      if (warmed.has(url) || pending.has(url)) continue;
      pending.add(url);
      queue.push(url);
    }
  }
  pump();
}
