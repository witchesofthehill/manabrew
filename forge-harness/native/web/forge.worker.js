self.scriptArgs = ["--browser"];

const relay = (text) => self.postMessage({ type: "log", text: String(text) });
for (const level of ["log", "warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...a) => { relay("[" + level + "] " + a.join(" ")); original(...a); };
}
self.onerror = (e) => relay("worker onerror: " + (e && e.message ? e.message : e));
self.addEventListener("unhandledrejection", (e) => relay("unhandled rejection: " + (e.reason && e.reason.stack || e.reason)));

self.onmessage = (e) => {
  if (!e.data || e.data.type !== "boot") return;
  relay("importScripts(forgeharness.js)");
  try {
    importScripts("./forgeharness.js");
    relay("importScripts returned");
  } catch (err) {
    relay("importScripts threw: " + (err && err.stack || err));
  }
};
