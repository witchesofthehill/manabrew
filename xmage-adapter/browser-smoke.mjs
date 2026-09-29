import { firefox } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("tmp", { recursive: true });
const browser = await firefox.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const counts = {};
let lastId = 0,
  finished = false,
  screenshot = false;
try {
  await page.goto("http://127.0.0.1:1420/xmage-research.html");
  const denied = await fetch("http://127.0.0.1:18765/snapshot", {
    headers: { Origin: "https://unrelated.example" },
  });
  if (denied.status !== 403) throw new Error("Origin was not rejected");
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const snap = await (await fetch("http://127.0.0.1:18765/snapshot")).json();
    if (snap.status === "finished") {
      finished = true;
      break;
    }
    const p = snap.prompt;
    if (!p || p.promptId === lastId) {
      await page.waitForTimeout(100);
      continue;
    }
    const i = p.input;
    await page.waitForTimeout(400);
    const body = await page.locator("body").innerText();
    if (body.includes("<div") || body.includes("<font"))
      throw new Error("Native markup leaked into presentation");
    let index = 0;
    const buttons = page.locator("button");
    if (i.type === "chooseBoolean") index = 0;
    else if (i.type === "chooseAction") {
      index = i.actions.findIndex((a) => a.type === "cast");
      if (index < 0) index = i.actions.findIndex((a) => a.type === "unclassified");
      if (index < 0) index = i.actions.length;
    } else if (i.type === "chooseObject") {
      const candidates = i.candidates
        .map((t, index) => ({ t, index }))
        .filter(({ t }) => !i.selected.some((s) => s.id === t.id));
      index =
        (
          candidates.find(({ t }) => t.kind === "player" && t.id !== p.decidingPlayerId) ??
          candidates[0]
        )?.index ?? -1;
      if (index < 0) {
        await page
          .getByRole("button", { name: i.canFinish ? "Done" : "Cancel", exact: true })
          .click();
        lastId = p.promptId;
        continue;
      }
    } else if (i.type === "payManaCost") {
      index = i.actions.length ? 0 : 0;
      if (!screenshot) {
        await page.screenshot({ path: "tmp/xmage-browser-payment.png", fullPage: true });
        screenshot = true;
      }
    } else if (i.type !== "chooseFromSelection") throw new Error(`Unhandled ${i.type}`);
    const wrong = await fetch("http://127.0.0.1:18765/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "response",
        promptId: p.promptId,
        action: { type: "reorder", output: {} },
      }),
    });
    if (wrong.status !== 409) throw new Error("Wrong-family request was not rejected");
    await buttons.nth(index).click({ timeout: 5000 });
    counts[i.type] = (counts[i.type] ?? 0) + 1;
    lastId = p.promptId;
  }
  if (!finished) throw new Error("Browser game did not finish");
  if (!counts.payManaCost || !counts.chooseObject || !counts.chooseAction)
    throw new Error("Browser did not exercise targeting and payment");
  if (errors.length) throw new Error(errors.join("\n"));
  await writeFile(
    "tmp/browser-check-result.json",
    JSON.stringify({ finished, counts, errors }, null, 2),
  );
  console.log(JSON.stringify({ finished, counts, errors }));
} finally {
  await browser.close();
}
