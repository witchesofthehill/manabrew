import type { Application } from "pixi.js";

const apps = new Set<Application>();
let installed = false;
let paused = false;

/**
 * Pause only when the page is genuinely hidden — minimised, occluded, or on a
 * background tab — where the browser stops servicing rAF anyway.
 *
 * Deliberately NOT keyed on `document.hasFocus()`. A window that sits visible
 * on a second monitor while the user works elsewhere is unfocused but still on
 * screen, and stopping the ticker there froze the board mid-game: opponents'
 * plays only appeared once the window regained focus (#618).
 */
function shouldPause(): boolean {
  return document.hidden;
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
