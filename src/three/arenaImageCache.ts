import { persistentArenaImage } from "@/three/persistentArenaImages";

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
const listeners = new Map<string, Set<(image: HTMLImageElement) => void>>();
const recovery = new Map<string, number>();
const deckImages = new Set<string>();
const backgroundRetries = new Map<string, number>();

export function watchArenaImage(url: string, onImage: (image: HTMLImageElement) => void) {
  let subscribers = listeners.get(url);
  if (!subscribers) listeners.set(url, (subscribers = new Set()));
  subscribers.add(onImage);
  const cached = images.get(url);
  if (cached) onImage(cached);
  else void loadArenaImage(url);
  return () => {
    subscribers.delete(onImage);
    if (!subscribers.size) {
      listeners.delete(url);
      if (!deckImages.has(url)) window.clearTimeout(recovery.get(url));
      if (!deckImages.has(url)) recovery.delete(url);
    }
  };
}

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
    const controller = new AbortController();
    let finished = false;
    const finish = (image: HTMLImageElement | null) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      if (image) {
        if (images.size >= Math.max(192, deckImages.size + 32)) {
          const evict = [...images.keys()].find(
            (url) => !deckImages.has(url) && !listeners.has(url),
          );
          if (evict) images.delete(evict);
        }
        images.set(job.url, image);
        jobs.delete(job.url);
        job.resolve(image);
        window.clearTimeout(recovery.get(job.url));
        recovery.delete(job.url);
        listeners.get(job.url)?.forEach((notify) => notify(image));
      } else if (job.attempts < 3) {
        window.setTimeout(() => {
          if (job.priority) queue.unshift(job);
          else queue.push(job);
          pump();
        }, job.attempts * 1000);
      } else {
        jobs.delete(job.url);
        job.resolve(null);
        if (
          (listeners.has(job.url) ||
            (deckImages.has(job.url) && (backgroundRetries.get(job.url) ?? 0) < 2)) &&
          !recovery.has(job.url)
        ) {
          recovery.set(
            job.url,
            window.setTimeout(() => {
              recovery.delete(job.url);
              if (listeners.has(job.url)) void loadArenaImage(job.url);
              else if (deckImages.has(job.url)) {
                backgroundRetries.set(job.url, (backgroundRetries.get(job.url) ?? 0) + 1);
                void loadArenaImage(job.url, false);
              }
            }, 30000),
          );
        }
      }
      window.setTimeout(() => {
        running--;
        pump();
      }, 150);
    };
    const timeout = window.setTimeout(() => {
      controller.abort();
      finish(null);
    }, 12000);
    void persistentArenaImage(job.url, controller.signal, job.priority).then(finish, () =>
      finish(null),
    );
  }
}

export function warmArenaDeckImages(names: (string | undefined)[]) {
  const cards = [...new Set(names)].filter((name): name is string =>
    Boolean(name && name !== "Hidden Card"),
  );
  deckImages.clear();
  backgroundRetries.clear();
  for (const name of cards) deckImages.add(arenaCardImageUrl(name, "large"));
  for (const url of deckImages) void loadArenaImage(url, false);
  for (const name of cards) void loadArenaImage(arenaCardImageUrl(name, "art_crop"), false);
}
