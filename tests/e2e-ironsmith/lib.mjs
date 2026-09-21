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
    await page.locator('input[placeholder*="StormCrow"]').first().waitFor({ timeout: 10000 });
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
  // The tab bar mounts after the account panel settles, so wait for the tab
  // rather than sampling once and moving on with the page half-built.
  const serverTab = page.getByRole("button", { name: /^Server$/ }).first();
  await serverTab.waitFor({ timeout: 20000 });
  await serverTab.click();
  await page.locator("#server-host").waitFor({ timeout: 20000 });
  await page.fill("#server-host", process.env.RELAY_HOST || "localhost");
  await page.fill("#server-port", process.env.RELAY_PORT || "9443");
  // The relay takes its name from onboarding now; the field only exists on
  // older builds, and waiting for it stalls the whole suite.
  const nameField = page.locator("#server-username");
  if (await nameField.count()) await nameField.fill(username);
  await page.fill("#server-password", process.env.RELAY_PW || "forge");
  await page.getByRole("button", { name: /Save & Reconnect/i }).click();
  await page.waitForTimeout(2500);
}

/** Create a Match room on the given engine + format, waiting for the relay to be connected first. */
export async function createRoom(page, { name, engine = "Ironsmith", format } = {}) {
  await page.goto(BASE() + "/lobby", { waitUntil: "networkidle" });
  const setUp = page.getByRole("button", { name: /Set up a table/i });
  for (let i = 0; i < 30 && (await setUp.isDisabled().catch(() => true)); i++) {
    await page.waitForTimeout(500);
  }
  await setUp.click();
  await page.waitForTimeout(600);
  // The engine picker starts collapsed on the setup page.
  const engineSummary = page.locator("summary", { hasText: /engine/i }).first();
  if (await engineSummary.count()) await engineSummary.click();
  await page.waitForTimeout(300);
  // Inside the picker only: the header's home button is named after the app.
  await page
    .locator("details")
    .filter({ hasText: /engine/i })
    .getByRole("button", { name: new RegExp(engine, "i") })
    .first()
    .click();
  await page.waitForTimeout(300);
  if (format) {
    await page.locator("#room-format").click();
    // The item's accessible name starts with its format badge ("STDStandard").
    await page
      .getByRole("menuitem", { name: new RegExp(`${format}$`) })
      .first()
      .click();
    await page.waitForTimeout(300);
  }
  if (name) await page.locator("#table-name").fill(name);
  await page.getByRole("button", { name: /^Create table$/i }).click();
  // The first Forge table on a fresh origin boots the engine to validate it
  // before the room opens, which is most of a minute on a dev server.
  await deckButton(page).waitFor({ timeout: 120000 });
  await page.waitForTimeout(500);
}

/** The room's deck picker button, whatever it is labelled at the time. */
export function deckButton(page) {
  return page.getByRole("button", { name: /^(Choose a deck|Change deck|Select Deck)$/i }).first();
}

/** Open the deck dialog opened by `opener` and pick a preset by (partial) name. */
export async function pickPreset(page, opener, preset) {
  await opener();
  const dlg = page.locator("[role=dialog]");
  await dlg.waitFor({ timeout: 5000 });
  // The tiles load after the dialog opens.
  const tile = dlg.getByRole("button", { name: new RegExp(preset, "i") }).first();
  await tile.waitFor({ timeout: 15000 }).catch(() => {
    throw new Error(`preset not found in dialog: ${preset}`);
  });
  await tile.click();
  // "Select Deck" for a seat, "Add Bot" for a bot's deck.
  const select = dlg.getByRole("button", { name: /^(Select Deck|Add Bot)$/ });
  await select.waitFor({ timeout: 5000 });
  for (let i = 0; i < 20 && !(await select.isEnabled()); i += 1) await page.waitForTimeout(250);
  await select.click();
  await page.waitForTimeout(900);
}

/** List the preset decks the picker currently offers (format-filtered). */
export async function listPresets(page) {
  await deckButton(page).click();
  const dlg = page.locator("[role=dialog]");
  await dlg.waitFor();
  const names = (
    await dlg
      .getByRole("button")
      .filter({ hasText: /Preset deck/ })
      .allTextContents()
  ).map((p) => p.replace("Preset deck", "").trim());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return names;
}
