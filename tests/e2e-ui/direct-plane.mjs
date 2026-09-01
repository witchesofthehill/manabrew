// UI e2e: does a browser seat actually leave the relay?
//
// Joins a room hosted by a self-hosted-node with the direct data plane on and
// checks the seat announces an endpoint, is attested, and reaches the host over
// iroh. A browser has no IP transports, so what it should report is
// `iroh-relayed` through the relay manabrew-server hosts — the browser path in
// full, which no Rust test can cover.
//
// Prerequisites, all local:
//   MANABREW_IROH_RELAY_PORT=9445 MANABREW_IROH_RELAY_URL=http://127.0.0.1:9445 \
//     cargo run -p manabrew-server
//   SELF_HOSTED_NODE_RELAY_URL=ws://127.0.0.1:9443 SELF_HOSTED_NODE_IROH=1 \
//     SELF_HOSTED_NODE_IROH_RELAY_URL=http://127.0.0.1:9445 \
//     CARDSET_ARCHIVE=src-tauri/resources/cardset.rkyv cargo run -p self-hosted-node
//   yarn dev:web
//
// Env: BASE, RELAY_HOST, RELAY_PORT, ROOM_NAME, HEADED=1.
import { chromium } from "playwright";
import { launchOpts, uniqueName, onboard, connectLocal } from "../e2e-ironsmith/lib.mjs";

const BASE = process.env.BASE || "http://localhost:1420";
const ROOM_NAME = process.env.ROOM_NAME || "Local direct room";
const step = (msg) => console.log(`· ${msg}`);

const browser = await chromium.launch(launchOpts());
const page = await browser.newPage();
// The client logs its wire traffic to a ring buffer for bug reports, not to the
// console, so watch the socket itself. Without this a failure cannot say
// whether the relay never named the data plane or the seat ignored it.
await page.addInitScript(() => {
  window.__wire = [];
  const Native = window.WebSocket;
  window.WebSocket = function (...args) {
    const socket = new Native(...args);
    socket.addEventListener("message", (event) => {
      try {
        const type = JSON.parse(event.data)?.type;
        if (type && type !== "Pong") window.__wire.push(type);
      } catch {
        /* not ours */
      }
    });
    return socket;
  };
  window.WebSocket.prototype = Native.prototype;
  Object.assign(window.WebSocket, Native);
});
const logs = [];
page.on("console", (m) => logs.push(m.text()));
page.on("pageerror", (e) => logs.push(`PAGEERROR ${e.message}`));

const name = uniqueName("Seat");
await onboard(page, name);
await connectLocal(page, name);
step("on the local relay");

await page.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

// The row naming this room, not the first join button on the page: the lobby
// carries every table the relay knows about.
const joined = await page.evaluate((label) => {
  const rows = [...document.querySelectorAll("div, li, article, section")].filter((el) => {
    const text = el.textContent || "";
    return text.includes(label) && /join table/i.test(text);
  });
  rows.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
  const button = rows[0]
    ? [...rows[0].querySelectorAll("button")].find((b) => /join table/i.test(b.textContent || ""))
    : null;
  if (!button) return false;
  button.click();
  return true;
}, ROOM_NAME);
if (!joined) {
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 500));
  throw new Error(`no table row named ${ROOM_NAME}; lobby says: ${text}`);
}
// A room advertised as `Any` asks the joiner to settle the format first, which
// is where the join actually happens.
const format = page.getByRole("button", { name: /^Standard/ }).first();
if (await format.count()) {
  await format.click();
  await page.waitForTimeout(1500);
  const confirm = page.getByRole("button", { name: /^(Join|Confirm|Continue)/i }).first();
  if (await confirm.count()) await confirm.click();
}
await page.waitForTimeout(3000);
step("joined the hosted table");

// The seat binds and dials on the first RoomTransport, which the relay sends on
// join, so nothing else has to happen for this to be decided.
await page.waitForTimeout(15000);

const reached = logs.find((l) => /seat reached the host over/i.test(l));
const direct = logs.filter((l) => /\[direct\]/i.test(l));
console.log("=== direct plane ===");
console.log(direct.length ? direct.join("\n") : "(nothing logged)");

if (!reached) {
  // Which link in the chain broke matters more than that it did: the relay has
  // to name the room's data plane before a seat can want one.
  const wire = await page.evaluate(() => window.__wire || []);
  const sawTransport = wire.includes("RoomTransport");
  const errors = logs.filter((l) => /PAGEERROR|Uncaught/i.test(l)).slice(0, 4);
  throw new Error(
    `the seat never reached the host. RoomTransport seen: ${sawTransport}. ` +
      `errors: ${errors.join(" | ") || "none"}. wire: ${[...new Set(wire)].join(",")}`,
  );
}
if (!/iroh-relayed|iroh-direct/.test(reached)) {
  throw new Error(`reached the host on an unexpected transport: ${reached}`);
}
step(`seat took the direct plane: ${reached.trim()}`);

await browser.close();
console.log("PASS");
