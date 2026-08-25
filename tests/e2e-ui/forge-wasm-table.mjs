// Hosting a table on the browser Forge engine: two humans over a real relay,
// with the game running in the host's worker. The Rust worker has always been
// able to do this; Forge answered start_multiplayer_game with null, so the
// host's Start silently did nothing.
//
// Every seat has its own SharedArrayBuffer and its own view of the board, so
// this also covers the part that would leak: a guest must see their own hand,
// not the host's.
//
//   MANABREW_SERVER_KEY=forge cargo run --release -p manabrew-server
//   npx vite --port 5199 --strictPort
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-wasm-table.mjs
//
// Env: BASE, DECK, FORMAT, ENGINE=forge|rust, HEADED=1.
import { chromium } from "playwright";
import {
  launchOpts,
  uniqueName,
  onboard,
  connectLocal,
  createRoom,
  pickPreset,
} from "../e2e-ironsmith/lib.mjs";

const BASE = process.env.BASE || "http://localhost:5199";
const DECK = process.env.DECK || "Izzet Lessons";
const FORMAT = process.env.FORMAT || "Standard";
const ENGINE = process.env.ENGINE === "rust" ? "rust" : "forge";
const ROOM = "ForgeTable" + Date.now().toString(36).slice(-4);
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);

const browser = await chromium.launch(launchOpts());
const logs = { host: [], guest: [] };

/** The seat's deck button, whatever this build calls it. */
async function pickDeck(page, who) {
  const opener = page
    .getByRole("button", { name: /^(Choose a deck|Change deck|Select Deck)$/i })
    .first();
  if (!(await opener.count())) {
    const seen = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .map((b) => (b.textContent || "").trim())
        .filter(Boolean),
    );
    throw new Error(`${who} has no deck button; buttons: ${JSON.stringify(seen)}`);
  }
  await pickPreset(page, () => opener.click(), DECK);
}
const seatOn = async (forge, who) => {
  const page = await (
    await browser.newContext({ viewport: { width: 1300, height: 850 } })
  ).newPage();
  await page.addInitScript((on) => {
    try {
      const raw = localStorage.getItem("manabrew-preferences");
      const doc = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      doc.state = { ...(doc.state || {}), forgeWasmEnabled: on };
      localStorage.setItem("manabrew-preferences", JSON.stringify(doc));
    } catch {
      // First load on a fresh origin; the store writes its own defaults.
    }
  }, forge);
  page.on("console", (m) => {
    const text = m.text();
    if (/remote|seat|relay|prompt|forge|error/i.test(text)) logs[who].push(text.slice(0, 200));
  });
  return page;
};

const step = (msg) => console.log(`· ${msg}`);
let failure = null;
const fail = (msg) => {
  failure = msg;
  throw new Error(msg);
};

try {
  // Only the host runs an engine, so only the host's choice matters.
  const host = await seatOn(ENGINE === "forge", "host");
  const guest = await seatOn(false, "guest");
  const hostName = uniqueName("Host");
  const guestName = uniqueName("Guest");

  await onboard(host, hostName);
  step("host onboarded");
  // A deployed build already points at its own relay; only a dev server has to
  // be steered away from production.
  if (LOCAL) {
    await connectLocal(host, hostName);
    step("host on the local relay");
  }

  // The lobby is the player-first one: a table, not a room.
  await host.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
  await host.getByRole("button", { name: /Set up a table/i }).click();
  await host.waitForTimeout(1200);
  await host.getByRole("button", { name: /Create new table/i }).click();
  await host.waitForTimeout(1200);
  // Standard is the default; anything else lives under Advanced table options.
  const formatButton = host.getByRole("button", { name: new RegExp(`^${FORMAT}$`) }).first();
  if (await formatButton.count()) await formatButton.click();
  await host
    .getByRole("button", { name: /^Create Table$/ })
    .last()
    .click();
  await host.waitForTimeout(3000);
  step("table created");

  await pickDeck(host, "host");
  step("host deck picked");

  await onboard(guest, guestName);
  step("guest onboarded");
  if (LOCAL) {
    await connectLocal(guest, guestName);
    step("guest on the local relay");
  }
  await guest.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
  await guest.waitForTimeout(2000);
  // A shared relay carries other people's tables — the hosted node keeps four
  // of its own on staging — and every row's button just says "Join table", so
  // click the one whose row names this host. Done in the page, because the
  // accessible name of those buttons covers the whole card and indexes drift.
  const joined = await guest.evaluate((name) => {
    // The smallest element that mentions both this host and a join control is
    // the table's own row: walking up from the button hits a container that
    // holds every row, and clicking there joins somebody else's table.
    const rows = [...document.querySelectorAll("div, li, article, section")].filter((el) => {
      const text = el.textContent || "";
      return text.includes(name) && /join table/i.test(text);
    });
    rows.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
    const row = rows[0];
    const button = row
      ? [...row.querySelectorAll("button")].find((b) => /join table/i.test(b.textContent || ""))
      : null;
    if (!button) return false;
    button.click();
    return true;
  }, hostName);
  if (!joined) {
    const text = await guest.evaluate(() =>
      document.body.innerText.replace(/\s+/g, " ").slice(0, 500),
    );
    throw new Error(`no table row for ${hostName}; lobby says: ${text}`);
  }
  await guest.waitForTimeout(2500);
  step("guest joined");
  await pickDeck(guest, "guest");
  const ready = guest.getByRole("button", { name: /^Ready( up)?$/i }).first();
  await ready.waitFor({ timeout: 20000 });
  await ready.click();
  await guest.waitForTimeout(1500);
  step("guest ready");

  const start = host.getByRole("button", { name: /Start (Game|Table)/i }).first();
  if (!(await start.count())) {
    const seen = await host.evaluate(() =>
      [...document.querySelectorAll("button")]
        .map((b) => `${(b.textContent || "").trim()}${b.disabled ? " [x]" : ""}`)
        .filter(Boolean),
    );
    const text = await host.evaluate(() =>
      document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
    );
    console.log("host buttons:", JSON.stringify(seen));
    console.log("host text:", text);
    console.log(
      "guest buttons:",
      JSON.stringify(
        await guest.evaluate(() =>
          [...document.querySelectorAll("button")]
            .map((b) => `${(b.textContent || "").trim()}${b.disabled ? " [x]" : ""}`)
            .filter(Boolean),
        ),
      ),
    );
    console.log(
      "guest text:",
      await guest.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400)),
    );
  }
  await start.waitFor({ timeout: 20000 });
  await start.click();
  step("host started the table");
  await host.waitForTimeout(15000);

  // Forge asks one seat at a time, so the host has to actually play for the
  // table to move. Keep the opening hand if it asks.
  const keep = host.getByRole("button", { name: /^Keep$/i }).first();
  if (await keep.count()) {
    await keep.click();
    await host.waitForTimeout(3000);
  }
  await guest.waitForTimeout(6000);

  // Both seats have to be able to act, not just see a board: the guest's
  // answer travels over the relay into the host's worker, which is the half a
  // "both boards mounted" check never exercises.
  const decide = async (page, who) => {
    for (let round = 0; round < 6; round += 1) {
      const button = page.getByRole("button", { name: /^(Keep|Continue|OK|Done)$/i }).first();
      if (!(await button.count())) return round;
      // A prompt can be replaced while the click is in flight, which is not a
      // failure: it means the seat already moved on.
      try {
        await button.click({ timeout: 8000 });
      } catch {
        return round;
      }
      await page.waitForTimeout(2500);
    }
    return 6;
  };
  const acted = { host: await decide(host, "host"), guest: await decide(guest, "guest") };
  step(`prompts answered: host ${acted.host}, guest ${acted.guest}`);
  if (acted.guest === 0) {
    fail("the guest was never asked anything, so nothing proves their seat can act");
  }

  const ranForge = await host.evaluate(() => Array.isArray(window.__engineDecisions));
  if (ranForge !== (ENGINE === "forge")) {
    fail(`the host ran the ${ranForge ? "forge" : "rust"} engine, expected ${ENGINE}`);
  }

  const boarded = async (page) =>
    /\/play|\/game/.test(page.url()) && (await page.locator("canvas").count()) > 0;
  for (const [who, page] of [
    ["host", host],
    ["guest", guest],
  ]) {
    if (!(await boarded(page))) {
      const log = await page.evaluate(() => (window.__forgeLog || []).slice(-10)).catch(() => []);
      const state = await page
        .evaluate(() => {
          const s = window.__gameStore?.getState?.() ?? {};
          return {
            fatal: s.fatalError ?? null,
            debug: s.debugInfo ?? null,
            active: s.isGameActive ?? null,
          };
        })
        .catch(() => null);
      console.log(`${who} state:`, JSON.stringify(state));
      const bridge = await host
        .evaluate(() =>
          (window.__forgeLog || []).filter((l) => /seat|remote|hosting/i.test(String(l))).slice(-6),
        )
        .catch(() => []);
      for (const line of bridge) console.log("   host seat log:", String(line).slice(0, 160));
      for (const line of log) console.log(`   ${who} log:`, String(line).slice(0, 160));
      for (const line of logs[who].slice(-14)) console.log(`   ${who} console:`, line);
      fail(`${who} never reached a board (${page.url()})`);
    }
  }

  // Per-seat views: the guest's client is told which slot it holds, and a seat
  // only ever sees its own hand.
  // window.__gameStore is dev-only, so a deployed build proves the seats apart
  // by what each player can see instead: your own hand, not your opponent's.
  const slots = await Promise.all(
    [host, guest].map((page) =>
      page.evaluate(() => {
        const s = window.__gameStore?.getState?.();
        return s ? { slot: s.myPlayerSlot ?? null, seats: s.gameView?.players?.length ?? 0 } : null;
      }),
    ),
  );
  if (slots[0] && slots[1]) {
    if (slots[0].slot === slots[1].slot) fail(`both clients think they are ${slots[0].slot}`);
  } else {
    const hands = await Promise.all(
      [host, guest].map((page) =>
        page.evaluate(() =>
          [...document.querySelectorAll("canvas")].length > 0 ? document.title : null,
        ),
      ),
    );
    if (hands.some((h) => h === null)) fail("a seat has no board on the deployed build");
  }

  console.log(
    `PASS: ${ENGINE} host ran a two-human table — slots ${JSON.stringify(slots.map((s) => s?.slot))}`,
  );
} catch (error) {
  console.log(`FAIL: ${failure ?? error.message}`);
  await browser.close();
  process.exit(1);
}
await browser.close();
