import { chromium } from "playwright";
import { launchOpts, onboard, connectLocal, uniqueName } from "../e2e-ironsmith/lib.mjs";
const BASE = process.env.BASE || "http://localhost:5199";
const browser = await chromium.launch(launchOpts());
const page = await (await browser.newContext()).newPage();
const name = uniqueName("Probe");
await onboard(page, name);
await connectLocal(page, name);
await page.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
console.log("url:", page.url());
console.log("text:", (await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))).slice(0, 400));
const btns = await page.evaluate(() =>
  [...document.querySelectorAll("button")].map((b) => `${(b.textContent || "").trim()}${b.disabled ? " [disabled]" : ""}`).filter(Boolean));
console.log("buttons:", JSON.stringify(btns.slice(0, 20)));
await page.getByRole("button", { name: /Set up a table/i }).click();
await page.waitForTimeout(1500);
console.log("dialog text:", (await page.evaluate(() => {
  const d = document.querySelector("[role=dialog]");
  return (d ? d.innerText : document.body.innerText).replace(/\s+/g, " ");
})).slice(0, 600));
console.log("dialog buttons:", JSON.stringify(await page.evaluate(() => {
  const d = document.querySelector("[role=dialog]") || document;
  return [...d.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 25);
})));
await page.getByRole("button", { name: /Create new table/i }).click();
await page.waitForTimeout(1500);
console.log("create text:", (await page.evaluate(() => {
  const d = document.querySelector("[role=dialog]");
  return (d ? d.innerText : document.body.innerText).replace(/\s+/g, " ");
})).slice(0, 800));
console.log("create buttons:", JSON.stringify(await page.evaluate(() => {
  const d = document.querySelector("[role=dialog]") || document;
  return [...d.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 30);
})));
await page.getByRole("button", { name: /^Create Table$/ }).last().click();
await page.waitForTimeout(4000);
console.log("room url:", page.url());
console.log("room text:", (await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))).slice(0, 500));
console.log("room buttons:", JSON.stringify(await page.evaluate(() =>
  [...document.querySelectorAll("button")].map((b) => `${(b.textContent || "").trim()}${b.disabled ? " [x]" : ""}`).filter(Boolean).slice(0, 25))));
await browser.close();
