// Regression: choosing the browser Forge engine in Settings must actually run
// it, even though the worker is constructed eagerly at app startup — before
// the choice is read. Reported from staging: "Forge in browser" was selected
// and the whole game ran on the Rust engine.
//
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-wasm-toggle.mjs
//
// Worth running against a production build too, not just the dev server: the
// engine's asset path differs between the two, and a dev-only module URL will
// pass here and 404 to index.html in a build.
import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";

const BASE = process.env.BASE || "http://localhost:5199";
const DECK = process.env.DECK || "Izzet Lessons";
const AI_DECK = process.env.AI_DECK || "Esper Pixie";
// Keep in step with lib/termsContent.ts and OnboardingWelcome.
const TERMS_VERSION = process.env.TERMS_VERSION || "1.5.0";
const ONBOARDING_VERSION = process.env.ONBOARDING_VERSION || "1.0";

const browser = await chromium.launch(launchOpts());
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const workers = [];
page.on("worker", (w) => workers.push(w.url()));

async function fail(msg) {
  console.log(`FAIL: ${msg}`);
  console.log("workers:", workers.map((u) => u.split("/").pop()).join(", ") || "(none)");
  await browser.close();
  process.exit(1);
}

// Seed the acknowledgements rather than clicking through onboarding: the
// nickname step validates against the Hub, which a local production build
// cannot reach, and none of it is what this test is about.
await page.addInitScript(
  ([terms, guide, name]) => {
    try {
      const record = (version) => JSON.stringify({ version, acceptedAt: new Date().toISOString() });
      localStorage.setItem("manabrew.termsAcceptance", record(terms));
      localStorage.setItem("manabrew.onboarding", record(guide));
      const raw = localStorage.getItem("manabrew-preferences");
      const doc = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      doc.state = { ...(doc.state || {}), serverUsername: name };
      localStorage.setItem("manabrew-preferences", JSON.stringify(doc));
    } catch {
      // First load on a fresh origin; the stores write their own defaults.
    }
  },
  [TERMS_VERSION, ONBOARDING_VERSION, uniqueName("Tog")],
);

// Start with the engine OFF, so app startup builds the Rust worker first.
await onboard(page, uniqueName("Tog"));
// A production bundle hydrates slower than the helper's fixed waits, so finish
// whatever step of onboarding is still on screen before going further.
for (let i = 0; i < 20; i++) {
  const agree = page.locator("text=I have read and agree").first();
  if (await agree.count().catch(() => 0)) {
    await agree.click().catch(() => {});
    await page
      .getByRole("button", { name: /Accept and continue/i })
      .first()
      .click()
      .catch(() => {});
  }
  const nick = page.locator('input[placeholder*="StormCrow"]').first();
  if (await nick.count().catch(() => 0)) {
    await nick.fill(uniqueName("Tog")).catch(() => {});
    await page
      .getByRole("button", { name: /Let's brew/i })
      .first()
      .click()
      .catch(() => {});
  }
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  if (!/Accept and continue|Let's brew/.test(text)) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(2000);
if (!workers.some((u) => u.includes("game-engine.worker"))) {
  console.log("note: the Rust worker was not built at startup; the race may not reproduce");
}

// Now turn it on the way a player does. This is the last full load; from here
// the run stays in the SPA so the startup worker is still the live one.
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
const card = page.locator("text=Forge engine in the browser").first();
await card.waitFor({ timeout: 15000 }).catch(() => null);
if (!(await card.count())) await fail("the Settings toggle is not present (is the flag on?)");
await page
  .locator("div")
  .filter({ hasText: /^Forge engine in the browser/ })
  .getByRole("button", { name: "On", exact: true })
  .first()
  .click();
await page.waitForTimeout(500);

// Reach Play by clicking, not by navigating: a reload would build a fresh
// worker from the new preference and hide the very bug this covers, which is
// the startup worker outliving the choice.
await page.getByRole("button", { name: "Play Offline" }).first().click();
await page.waitForTimeout(1500);
if (!/\/play\/offline/.test(page.url())) {
  await page
    .getByRole("link", { name: /Play Offline/i })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(1500);
}
if (!/\/play\/offline/.test(page.url()))
  await fail(`did not reach Play Offline (url ${page.url()})`);
await page.getByRole("button", { name: "Standard", exact: true }).click();
await page.waitForTimeout(600);
for (const deck of [DECK, AI_DECK]) {
  const tile = page.getByRole("button", { name: new RegExp(`^${deck}`) }).first();
  if (!(await tile.count())) await fail(`deck "${deck}" is not on the Standard tab`);
  await tile.click();
  await page.waitForTimeout(500);
}
await page.waitForFunction(
  () => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      /^Fight!$/.test(x.textContent || ""),
    );
    return b && !b.disabled;
  },
  { timeout: 15000 },
);
await page.getByRole("button", { name: /^Fight!$/ }).click();
await page.waitForTimeout(25000);

if (!workers.some((u) => u.includes("forge-engine.worker"))) {
  await fail("the game did not run on the browser Forge engine");
}
const frames = await page.evaluate(() => (window.__forgeFrames || []).length).catch(() => 0);
if (!frames) await fail("the Forge worker was built but sent no frames");

console.log(`PASS: Settings choice took effect — Forge worker ran, ${frames} frames`);
console.log("workers built:", workers.map((u) => u.split("/").pop()).join(" -> "));
await browser.close();
