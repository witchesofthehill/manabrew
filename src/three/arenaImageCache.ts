type ImageJob = {
  url: string;
  priority: boolean;
  attempts: number;
  promise: Promise<HTMLImageElement | null>;
  resolve: (image: HTMLImageElement | null) => void;
};
const images = new Map<string, HTMLImageElement>();
const jobs = new Map<string, ImageJob>();
const queue: ImageJob[] = [];
let running = 0;

export const arenaCardImageUrl = (name: string, variant: string) =>
  `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=${variant}`;

export function cachedArenaImage(url: string) {
  return images.get(url);
}

export function loadArenaImage(url: string, priority = true): Promise<HTMLImageElement | null> {
  const cached = images.get(url);
  if (cached) return Promise.resolve(cached);
  const existing = jobs.get(url);
  if (existing) {
    if (priority) {
      existing.priority = true;
      const index = queue.indexOf(existing);
      if (index >= 0) queue.unshift(...queue.splice(index, 1));
    }
    return existing.promise;
  }
  let resolve!: ImageJob["resolve"];
  const promise = new Promise<HTMLImageElement | null>((done) => {
    resolve = done;
  });
  const job = { url, priority, attempts: 0, promise, resolve };
  jobs.set(url, job);
  if (priority) queue.unshift(job);
  else queue.push(job);
  pump();
  return promise;
}

function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift()!;
    running++;
    job.attempts++;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.fetchPriority = job.priority ? "high" : "low";
    let finished = false;
    const finish = (success: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      image.onload = image.onerror = null;
      if (success) {
        if (images.size >= 192) images.delete(images.keys().next().value!);
        images.set(job.url, image);
        jobs.delete(job.url);
        job.resolve(image);
      } else if (job.attempts < 3) {
        window.setTimeout(() => {
          if (job.priority) queue.unshift(job);
          else queue.push(job);
          pump();
        }, job.attempts * 1000);
      } else {
        jobs.delete(job.url);
        job.resolve(null);
      }
      window.setTimeout(() => {
        running--;
        pump();
      }, 150);
    };
    const timeout = window.setTimeout(() => {
      image.src = "";
      finish(false);
    }, 12000);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = job.url;
  }
}

export function warmArenaDeckImages(names: (string | undefined)[]) {
  for (const name of new Set(names)) {
    if (!name || name === "Hidden Card") continue;
    for (const variant of ["large", "art_crop"])
      void loadArenaImage(arenaCardImageUrl(name, variant), false);
  }
}
