import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";
const BASE = process.env.BASE || "http://localhost:5199";
const b = await chromium.launch(launchOpts());
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
let err = null;
p.on("pageerror", (e) => { if (!err) err = String(e).slice(0, 300); });
await p.addInitScript(() => {
  try {
    const raw = localStorage.getItem("manabrew-preferences");
    const doc = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    doc.state = { ...(doc.state || {}), forgeWasmEnabled: true };
    localStorage.setItem("manabrew-preferences", JSON.stringify(doc));
  } catch {}
});
await onboard(p, uniqueName("Rep"));
await p.goto(`${BASE}/play/offline/constructed`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Standard", exact: true }).click();
await p.waitForTimeout(600);
for (const d of ["Izzet Lessons", "Esper Pixie"]) {
  await p.getByRole("button", { name: new RegExp(`^${d}`) }).first().click();
  await p.waitForTimeout(500);
}
await p.waitForFunction(() => { const b=[...document.querySelectorAll("button")].find(x=>/^Fight!$/.test(x.textContent||"")); return b && !b.disabled; }, { timeout: 15000 });
await p.getByRole("button", { name: /^Fight!$/ }).click();
await p.waitForTimeout(18000);

// Auto-play until the crash, recording every sourceCard we see.
await p.evaluate(() => {
  const s = window.__gameStore; window.__seen = [];
  const ids = (l) => (l||[]).map(c=>c&&(c.id||c.cardId)).filter(Boolean);
  const ans = (i) => {
    switch (i.type) {
      case "chooseAction": { const a=(i.actions||[]).find(x=>x.type==="cast"); return a?{type:"act",actionId:a.id}:{type:"pass"}; }
      case "payManaCost": { if(i.canConfirmFromPool) return {type:"pay"}; const m=(i.actions||[]).find(x=>x.isManaAbility); return m?{type:"act",actionId:m.id}:{type:"cancel"}; }
      case "chooseBoardTargets": { const c=(i.candidates||[])[0]; return c?{type:"boardTargets",chosen:[{kind:c.kind,id:c.id}]}:{type:"cancel"}; }
      case "mulligan": return {type:"mulligan",keep:true};
      case "mulliganPutBack": return {type:"mulliganPutBack",cardIds:ids(i.cards).slice(0,i.count||0)};
      case "chooseCards": return {type:"chooseCards",chosenCardIds:ids(i.cards).slice(0,i.min||0)};
      case "chooseAttackers": return {type:"declareAttackers",assignments:[]};
      case "chooseBlockers": return {type:"declareBlockers",assignments:[]};
      case "chooseBoolean": return {type:"chooseBoolean",value:false};
      case "diceRolled": return {type:"diceRolled"};
      default: return null;
    }
  };
  let last=null;
  window.__t = setInterval(() => {
    const st=s.getState(); const pr=st.currentPrompt;
    if(!pr||st.isWaitingForResponse||pr.promptId===last) return;
    if(pr.sourceCard) window.__seen.push({type:pr.input?.type, src:pr.sourceCard});
    const a=ans(pr.input||{}); if(!a) return;
    last=pr.promptId; Promise.resolve(st.respond(a)).catch(()=>{});
  }, 60);
});
for (let i=0;i<180 && !err;i++) await p.waitForTimeout(1000);
const seen = await p.evaluate(() => (window.__seen||[]).slice(-3)).catch(()=>[]);
const decks = await p.evaluate(() => Object.keys(window.__gameStore.getState().gameDecks||{})).catch(()=>[]);
console.log("pageerror:", err || "(none)");
console.log("gameDecks keys:", JSON.stringify(decks));
console.log("last sourceCards:", JSON.stringify(seen, null, 1).slice(0, 1500));
await b.close();
