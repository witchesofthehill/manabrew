// Hosting a table on the browser Forge engine: humans over a real relay, with
// the game running in the host's worker. The Rust worker has always been able
// to do this; Forge answered start_multiplayer_game with null, so the host's
// Start silently did nothing.
//
// Every seat has its own SharedArrayBuffer and its own view of the board, so
// this also covers the part that would leak: a guest must see their own hand,
// not the host's.
//
//   MANABREW_SERVER_KEY=forge cargo run --release -p manabrew-server
//   npx vite --port 5199 --strictPort
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-wasm-table.mjs
//
// SEATS=4 runs a four-player table, which is a different shape and not just a
// bigger one: the engine hands out four buffers and asks four seats in turn.
//
// Env: BASE, DECK, FORMAT, SEATS, ENGINE=forge|rust, HEADED=1.
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
const SEATS = Math.min(4, Math.max(2, Number(process.env.SEATS || 2)));
const ROOM = "ForgeTable" + Date.now().toString(36).slice(-4);
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);

const browser = await chromium.launch(launchOpts());
const logs = { host: [], guest: [] };
/** Every page at the table, host first. Filled in once the seats exist. */
let host = null;
const guests = [];
const everyone = () => [host, ...guests];

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
  host = await seatOn(ENGINE === "forge", "host");
  const guestNames = [];
  for (let index = 0; index < SEATS - 1; index += 1) {
    guests.push(await seatOn(false, "guest"));
    guestNames.push(uniqueName(`Guest${index + 1}`));
  }
  const hostName = uniqueName("Host");

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
  // Seats: the dialog offers 2, 3 and 4.
  const seatButton = host.getByRole("button", { name: new RegExp(`^${SEATS}$`) }).first();
  if (!(await seatButton.count()))
    throw new Error(`the create dialog offers no ${SEATS}-seat option`);
  await seatButton.click();
  await host.waitForTimeout(400);
  await host
    .getByRole("button", { name: /^Create Table$/ })
    .last()
    .click();
  await host.waitForTimeout(3000);
  step("table created");

  await pickDeck(host, "host");
  step("host deck picked");

  for (let index = 0; index < guests.length; index += 1) {
    const guest = guests[index];
    const name = guestNames[index];
    const who = `guest ${index + 1}`;
    await onboard(guest, name);
    if (LOCAL) await connectLocal(guest, name);
    await guest.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
    await guest.waitForTimeout(2000);
    // A shared relay carries other people's tables — the hosted node keeps
    // four of its own on staging — and every row's button just says "Join
    // table", so click the one whose row names this host. Done in the page,
    // because the accessible name of those buttons covers the whole card and
    // indexes drift.
    const joined = await guest.evaluate((hostLabel) => {
      // The smallest element that mentions both this host and a join control
      // is the table's own row: walking up from the button reaches a container
      // holding every row, and clicking there joins somebody else's table.
      const rows = [...document.querySelectorAll("div, li, article, section")].filter((el) => {
        const text = el.textContent || "";
        return text.includes(hostLabel) && /join table/i.test(text);
      });
      rows.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
      const button = rows[0]
        ? [...rows[0].querySelectorAll("button")].find((b) =>
            /join table/i.test(b.textContent || ""),
          )
        : null;
      if (!button) return false;
      button.click();
      return true;
    }, hostName);
    if (!joined) {
      const text = await guest.evaluate(() =>
        document.body.innerText.replace(/\s+/g, " ").slice(0, 500),
      );
      throw new Error(`no table row for ${hostName} when seating ${who}; lobby says: ${text}`);
    }
    await guest.waitForTimeout(2500);
    await pickDeck(guest, who);
    const ready = guest.getByRole("button", { name: /^Ready( up)?$/i }).first();
    await ready.waitFor({ timeout: 20000 });
    await ready.click();
    await guest.waitForTimeout(1500);
    step(`${who} seated and ready`);
  }

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
  }
  await start.waitFor({ timeout: 20000 });
  await start.click();
  step("host started the table");
  await host.waitForTimeout(15000);

  // Forge asks one seat at a time, so somebody has to actually play for the
  // table to move. Keep the opening hand wherever it is asked, in rounds: with
  // four seats the engine works around the table, and a seat only hears from
  // it when its turn to decide comes.
  const decide = async (page) => {
    let answered = 0;
    for (let round = 0; round < 8; round += 1) {
      const button = page.getByRole("button", { name: /^(Keep|Continue|OK|Done)$/i }).first();
      if (!(await button.count())) break;
      // A prompt can be replaced while the click is in flight, which is not a
      // failure: it means the seat already moved on.
      try {
        await button.click({ timeout: 8000 });
      } catch {
        break;
      }
      answered += 1;
      await page.waitForTimeout(2000);
    }
    return answered;
  };

  let acted = 0;
  for (let round = 0; round < 3; round += 1) {
    for (const page of everyone()) acted += await decide(page);
  }
  step(`prompts answered across the table: ${acted}`);
  if (acted === 0) fail("nobody was asked anything, so nothing proves a seat can act");

  const ranForge = await host.evaluate(() => Array.isArray(window.__engineDecisions));
  if (ranForge !== (ENGINE === "forge")) {
    fail(`the host ran the ${ranForge ? "forge" : "rust"} engine, expected ${ENGINE}`);
  }

  const boarded = async (page) =>
    /\/play|\/game/.test(page.url()) && (await page.locator("canvas").count()) > 0;
  const seats = everyone();
  for (let index = 0; index < seats.length; index += 1) {
    const who = index === 0 ? "host" : `guest ${index}`;
    if (!(await boarded(seats[index]))) {
      const log = await seats[index]
        .evaluate(() => (window.__forgeLog || []).slice(-8))
        .catch(() => []);
      for (const line of log) console.log(`   ${who} log:`, String(line).slice(0, 150));
      fail(`${who} never reached a board (${seats[index].url()})`);
    }
  }

  // Every seat has to be its own seat. On a dev server the store says which
  // slot it holds; a deployed build only shows the board, so there the check
  // is that each one has one.
  const slots = await Promise.all(
    seats.map((page) =>
      page.evaluate(() => {
        const state = window.__gameStore?.getState?.();
        return state ? (state.myPlayerSlot ?? null) : null;
      }),
    ),
  );
  if (slots.every((slot) => slot !== null) && new Set(slots).size !== slots.length) {
    fail(`seats collided: ${JSON.stringify(slots)}`);
  }

  console.log(
    `PASS: ${ENGINE} host ran a ${SEATS}-player table — slots ${JSON.stringify(slots)}, ${acted} prompts answered`,
  );
} catch (error) {
  console.log(`FAIL: ${failure ?? error.message}`);
  await browser.close();
  process.exit(1);
}
await browser.close();
