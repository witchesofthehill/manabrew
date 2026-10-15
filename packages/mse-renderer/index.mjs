import { createBrowserMseSession as createSession } from "./lib/mse/browser-session.mjs";
import upstream from "./lib/mse/upstream.mjs";
import corpus from "./corpus-index.json" with { type: "json" };
import { createCorpusFetcher, resolveCorpusUrl } from "./corpus-source.mjs";
import { selectMsePresentation as selectPresentation } from "./lib/mse/style-selection.mjs";
import { printingMseSetFields as printingSetFields } from "./lib/mse/printing-style.mjs";
import {
  classFields,
  levelerFields,
  mutateFields,
  planarFields,
  prototypeFields,
} from "./layout-fields.mjs";

export {
  engineCardToMse,
  engineDoubleFacesToMse,
  engineRulesToMse,
} from "./lib/mse/engine-card.mjs";
export { printingMseCardFields, printingMseFooterFields } from "./lib/mse/printing-style.mjs";

export const MSE_CORPUS_REVISION = upstream.revision;
export const MSE_DEFAULT_CORPUS_URL = `https://raw.githubusercontent.com/${upstream.repository}/${upstream.revision}/`;

export function printingMseSetFields(snapshot, printing) {
  return { ...printingSetFields(snapshot, printing), automatic_reminder_text: "" };
}

const layoutStyles = {
  room: "magic-m15-split-fusable.mse-style",
  aftermath: "magic-m15-aftermath.mse-style",
  flip: "magic-m15-flip.mse-style",
  prepare: "magic-m15-adventure.mse-style",
  planar: "magic-planechase.mse-style",
  scheme: "magic-archenemy.mse-style",
  token: "magic-m15-mainframe-tokens.mse-style",
  double_faced_token: "magic-m15-mainframe-tokens.mse-style",
  emblem: "magic-m15-mainframe-tokens.mse-style",
  vanguard: "magic-vanguard.mse-style",
};

const supportedLayouts = new Set([
  "normal",
  "split",
  "flip",
  "transform",
  "modal_dfc",
  "meld",
  "leveler",
  "class",
  "case",
  "saga",
  "adventure",
  "prepare",
  "mutate",
  "prototype",
  "battle",
  "planar",
  "scheme",
  "vanguard",
  "token",
  "double_faced_token",
  "emblem",
  "room",
  "aftermath",
]);

function resolveMsePresentation(snapshot, options = {}) {
  const face = snapshot.card_faces?.[options.faceIndex ?? 0] ?? snapshot;
  const layout =
    snapshot.layout === "reversible_card" ? face.layout : (snapshot.layout ?? "normal");
  const presentation = selectPresentation(
    layout === snapshot.layout ? snapshot : { ...snapshot, layout },
    options,
  );
  if (presentation.source === "explicit") return presentation;
  const unavailable = (reason) => ({ style: null, styling: {}, source: "general", reason });
  if (!supportedLayouts.has(layout)) return unavailable("unknown-layout");
  const faces = snapshot.card_faces;
  const multipart = ["split", "room", "aftermath", "adventure", "prepare", "flip"].includes(layout);
  const doubleFaced = ["transform", "modal_dfc", "double_faced_token", "battle"].includes(layout);
  if ((multipart || doubleFaced || snapshot.layout === "reversible_card") && faces?.length !== 2)
    return unavailable("invalid-faces");
  if ((options.faceIndex ?? 0) >= (faces?.length || 1) || faces?.length > 2)
    return unavailable("invalid-faces");
  if (
    faces?.length > 1 &&
    !multipart &&
    !doubleFaced &&
    snapshot.layout !== "reversible_card" &&
    layout !== "meld"
  )
    return unavailable("invalid-faces");
  if (presentation.source === "printing" && !presentation.style) return presentation;
  const rules = String(face.oracle_text ?? face.effect_text ?? face.ability_text ?? "");
  const type = String(face.type_line ?? "");
  if (/\b(?:Dungeon|Attraction|Contraption|Sticker)\b/.test(type))
    return unavailable("unsupported-card-type");
  const classCard = /\bClass\b/.test(type);
  const prototype = prototypeFields(rules);
  const mutate = prototype ? null : mutateFields(rules);
  if ((layout === "prototype" && !prototype) || (layout === "mutate" && !mutate))
    return unavailable("unrepresentable-fields");
  if (presentation.source === "printing" && (classCard || prototype || mutate))
    return unavailable("unsupported-treatment");
  if (presentation.source === "printing" && !classCard && !prototype && !mutate) {
    return presentation;
  }
  let style = layoutStyles[layout];
  let fields = { nativeCard: {}, styling: {} };
  if (!style && /\bPlaneswalker\b/.test(type)) {
    style = "magic-m15-mainframe-planeswalker.mse-style";
  }
  if (layout === "room" || (layout === "split" && /\bRoom\b/.test(type))) {
    style = "magic-m15-split-fusable.mse-style";
    fields.styling = { frames: "room", image_layout: "two images" };
  } else if (layout === "prepare") {
    fields.styling = { left_style: "name and type flat", right_style: "none" };
  } else if (layout === "planar") {
    fields = planarFields(rules, type);
  } else if (layout === "vanguard") {
    const nativeCard = {};
    if (face.hand_modifier !== undefined) nativeCard.hand_mod = face.hand_modifier;
    if (face.life_modifier !== undefined) nativeCard.life_mod = face.life_modifier;
    fields = { nativeCard, styling: {} };
  } else if (classCard) {
    style = "magic-genevensis-11-class.mse-style";
    fields = classFields(rules);
  } else if (layout === "leveler") {
    const levels = levelerFields(rules);
    if (!levels) return unavailable("unrepresentable-fields");
    style = "magic-m15-leveler.mse-style";
    fields = levels;
  } else if (prototype || mutate) {
    style = "magic-m15-altered.mse-style";
    fields = prototype ?? mutate;
  } else if (style === "magic-m15-mainframe-tokens.mse-style" && face.mana_cost) {
    fields.styling.frames = "copy";
  }
  if (!style) return presentation;
  const available = options.availableStyles;
  return {
    ...(available == null || new Set(available).has(style)
      ? { style }
      : { style: null, requestedTemplate: style, reason: "missing-template" }),
    ...fields,
    source: "general",
  };
}

export function selectMsePresentation(snapshot, options = {}) {
  const faceIndex = options.faceIndex ?? 0;
  const face = snapshot.card_faces?.[faceIndex] ?? snapshot;
  const layout =
    snapshot.layout === "reversible_card"
      ? (face.layout ?? "unknown")
      : (snapshot.layout ?? "normal");
  const { reason, requestedTemplate, ...presentation } = resolveMsePresentation(snapshot, options);
  const decision = presentation.style
    ? { mode: "native", template: presentation.style, layout, faceIndex }
    : {
        mode: "original",
        reason,
        layout,
        faceIndex,
        ...(requestedTemplate ? { template: requestedTemplate } : {}),
      };
  return { ...presentation, decision };
}

export function selectMseStyle(snapshot, options) {
  return selectMsePresentation(snapshot, options).style;
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function createBrowserMseSession(options = {}) {
  const configured = options.corpusUrl ?? import.meta.env?.VITE_MSE_CORPUS_URL;
  const corpusUrl = configured || MSE_DEFAULT_CORPUS_URL;
  const fetcher = options.fetcher ?? globalThis.fetch;
  const source = resolveCorpusUrl(corpusUrl);
  const fetchResource = createCorpusFetcher({
    source,
    pinnedSource: MSE_DEFAULT_CORPUS_URL,
    corpus,
    fetcher,
  });
  return createSession({
    ...options,
    corpusUrl: source.href,
    expectedRevision: MSE_CORPUS_REVISION,
    fetcher: fetchResource,
    createCanvas: options.createCanvas ?? createCanvas,
    allowSystemFonts: options.allowSystemFonts ?? false,
  });
}
