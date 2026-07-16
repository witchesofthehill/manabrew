// Reusable Playwright helpers for driving the Manabrew web client through a
// full multiplayer flow against a local relay. Written for the Ironsmith
// trusted-runtime work but the connect / room / deck helpers are engine-generic.
//
// Env knobs (all optional):
//   BASE       base URL of the running web client   (default http://localhost:1420)
//   RELAY_HOST relay host to point the client at     (default localhost)
//   RELAY_PORT relay port                            (default 9443)
//   RELAY_PW   relay password / server key           (default forge)
//   HEADED     set to "1" to watch the run in a real window

const BASE = () => process.env.BASE || "http://localhost:1420";

export function launchOpts() {
  return { channel: "chrome", headless: process.env.HEADED !== "1" };
}

/** A short unique player name so reruns never collide with a relay's preserved seats. */
export function uniqueName(prefix = "Iron") {
  return prefix + Date.now().toString(36).slice(-5) + Math.floor(Math.random() * 1e3);
}

/** Dump every visible interactive control — handy when a step's selector needs discovering. */
export async function controls(page) {
  return page.evaluate(() => {
    const out = new Set();
    for (const el of document.querySelectorAll(
      "button, a, input, [role=button], [role=tab], select, [role=dialog] *",
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const label = (
        el.getAttribute("placeholder") ||
        el.textContent ||
        el.getAttribute("aria-label") ||
        el.getAttribute("name") ||
        ""
      )
        .trim()
        .slice(0, 45);
      if (label && label.length > 1) out.add(`${el.tagName.toLowerCase()}: "${label}"`);
    }
    return [...out];
  });
}

/** Accept the first-run terms and set a nickname. Idempotent. */
export async function onboard(page, nickname) {
  await page.goto(BASE() + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const agree = page.locator("text=I have read and agree").first();
  if (await agree.count()) {
    await agree.click();
    await page.getByRole("button", { name: /Accept and continue/i }).click();
    await page.waitForTimeout(1200);
  }
  const nick = page.locator('input[placeholder*="StormCrow"]').first();
  if (await nick.count()) {
    await nick.fill(nickname);
    await page.getByRole("button", { name: /Let's brew/i }).click();
    await page.waitForTimeout(1200);
  }
}

/**
 * Point the client at the local relay via Settings → Server and reconnect.
 * IMPORTANT: without this the client auto-connects to the PRODUCTION relay
 * (relay.manabrew.app) — never create Ironsmith test rooms there.
 */
export async function connectLocal(page, username) {
  await page.goto(BASE() + "/settings", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const serverTab = page.getByRole("button", { name: /^Server$/ }).first();
  if (await serverTab.count()) await serverTab.click();
  await page.locator("#server-host").waitFor({ timeout: 10000 });
  await page.fill("#server-host", process.env.RELAY_HOST || "localhost");
  await page.fill("#server-port", process.env.RELAY_PORT || "9443");
  await page.fill("#server-username", username);
  await page.fill("#server-password", process.env.RELAY_PW || "forge");
  await page.getByRole("button", { name: /Save & Reconnect/i }).click();
  await page.waitForTimeout(2500);
}

/** Create a Match room on the given engine + format, waiting for the relay to be connected first. */
export async function createRoom(page, { name, engine = "Ironsmith", format } = {}) {
  await page.goto(BASE() + "/lobby", { waitUntil: "networkidle" });
  const newRoom = page.getByRole("button", { name: /New Room/i });
  for (let i = 0; i < 30 && (await newRoom.isDisabled().catch(() => true)); i++) {
    await page.waitForTimeout(500);
  }
  await newRoom.click();
  const dlg = page.locator("[role=dialog]");
  await dlg.getByRole("button", { name: new RegExp(engine, "i") }).first().click();
  await page.waitForTimeout(300);
  if (format) {
    await dlg.getByRole("button", { name: new RegExp(`^${format}`) }).first().click();
    await page.waitForTimeout(300);
  }
  const nameInput = page.locator('input[value*="Room"], input[placeholder*="Room"]').first();
  if ((await nameInput.count()) && name) await nameInput.fill(name);
  await dlg.getByRole("button", { name: /Create Room/i }).click();
  await page.waitForTimeout(2500);
}

/** Open the deck dialog opened by `opener` and pick a preset by (partial) name. */
export async function pickPreset(page, opener, preset) {
  await opener();
  const dlg = page.locator("[role=dialog]");
  await dlg.waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);
  const tile = dlg.getByRole("button", { name: new RegExp(preset, "i") }).first();
  if (!(await tile.count())) throw new Error(`preset not found in dialog: ${preset}`);
  await tile.click();
  await page.waitForTimeout(300);
  await dlg.getByRole("button", { name: /^Select Deck$/ }).click();
  await page.waitForTimeout(900);
}

/** List the preset decks the picker currently offers (format-filtered). */
export async function listPresets(page) {
  await page.getByRole("button", { name: /^Select Deck$/ }).click();
  const dlg = page.locator("[role=dialog]");
  await dlg.waitFor();
  const names = (
    await dlg.getByRole("button").filter({ hasText: /Preset deck/ }).allTextContents()
  ).map((p) => p.replace("Preset deck", "").trim());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return names;
}
