import type { Application } from "pixi.js";

const apps = new Set<Application>();
let installed = false;
let paused = false;

function shouldPause(): boolean {
  return document.hidden || !document.hasFocus();
}

function sync(): void {
  const next = shouldPause();
  if (next === paused) return;
  paused = next;
  for (const app of apps) {
    if (!app.ticker) continue;
    if (paused) app.ticker.stop();
    else app.ticker.start();
  }
}

function install(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("blur", sync);
  window.addEventListener("focus", sync);
  paused = shouldPause();
}

export function registerPixiApp(app: Application): () => void {
  install();
  apps.add(app);
  if (paused && app.ticker) app.ticker.stop();
  return () => {
    apps.delete(app);
  };
}
