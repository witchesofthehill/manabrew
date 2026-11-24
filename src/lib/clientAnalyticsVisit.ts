import { trackClientEvent } from "@/lib/clientAnalytics";
import { analyticsVisitDuration } from "@/lib/clientAnalyticsPrivacy";
import type { ClientAnalyticsAttributes } from "@/lib/clientAnalyticsPrivacy";

type VisitSignal = ClientAnalyticsAttributes<"visit_signal">;

const AGE_MILESTONES_MS = [60_000, 600_000, 3_600_000];
const MAX_HIDDEN_SIGNALS = 10;
const HEADLESS_AGENT = /HeadlessChrome|PhantomJS|Lighthouse|Prerender|bot\b|crawler|spider/i;
const ACTIVE_INPUTS = ["pointerdown", "keydown", "touchstart"];
const PASSIVE_INPUTS = ["pointermove", "wheel", "touchmove"];

let started = false;
let input: VisitSignal["input"] = "none";
let visibleMs = 0;
let visibleSince: number | undefined;
let hiddenSignals = 0;
let hiddenSent = false;

function automation(): VisitSignal["automation"] {
  if (navigator.webdriver) return "webdriver";
  return HEADLESS_AGENT.test(navigator.userAgent) ? "headless" : "none";
}

function visibleTotal(now: number) {
  return visibleMs + (visibleSince === undefined ? 0 : now - visibleSince);
}

function send(trigger: VisitSignal["trigger"]) {
  const now = performance.now();
  trackClientEvent("visit_signal", {
    trigger,
    age: analyticsVisitDuration(now),
    visible: analyticsVisitDuration(visibleTotal(now)),
    input,
    automation: automation(),
  });
}

function hidden() {
  if (hiddenSent || hiddenSignals >= MAX_HIDDEN_SIGNALS) return;
  hiddenSent = true;
  hiddenSignals++;
  send("hidden");
}

function visibilityChanged() {
  const now = performance.now();
  if (document.visibilityState === "visible") {
    visibleSince ??= now;
    hiddenSent = false;
    return;
  }
  if (visibleSince !== undefined) visibleMs += now - visibleSince;
  visibleSince = undefined;
  hidden();
}

export function startClientVisitSignals() {
  if (started) return;
  started = true;
  if (document.visibilityState === "visible") visibleSince = performance.now();
  const active = (event: Event) => {
    if (event.isTrusted) input = "active";
  };
  const passive = (event: Event) => {
    if (event.isTrusted && input === "none") input = "passive";
  };
  for (const type of ACTIVE_INPUTS)
    window.addEventListener(type, active, { capture: true, passive: true });
  for (const type of PASSIVE_INPUTS)
    window.addEventListener(type, passive, { capture: true, passive: true });
  document.addEventListener("visibilitychange", visibilityChanged, true);
  window.addEventListener("pagehide", hidden, true);
  for (const milestone of AGE_MILESTONES_MS)
    window.setTimeout(() => send("age"), Math.max(0, milestone - performance.now()));
}
