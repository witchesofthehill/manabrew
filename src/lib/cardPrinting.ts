import { magic } from "card-glint/magic";
import {
  composePrintingSelection,
  resolvePrintingPreset,
  splitPanels,
  withCardWording,
  type PrintingSelection,
  type RenderedCardInput,
} from "card-glint/magic/presentation";
import type { CardCosmetics, CardPrintingSelection } from "@/protocol/deck";
import type { PreparedCard } from "@/lib/cardRenderSnapshot";
import { isSemanticLayout, type SemanticCardInput } from "@/lib/cardSemanticLayout";

function selectionFor(
  printing: CardPrintingSelection | undefined,
  index: number,
  border: CardCosmetics["border"],
): PrintingSelection {
  if (!printing && (!border || border === "printing")) return { preset: "match" };
  const local = printing?.faces?.[index];
  const selection = composePrintingSelection(
    { preset: local?.preset ?? printing?.preset ?? "match" },
    { overrides: border && border !== "printing" ? { borderColor: border } : undefined },
    { overrides: printing?.overrides, art: printing?.art },
    { overrides: local?.overrides, art: local?.art },
  );
  if (local?.art?.mode === "window" && selection.art) delete selection.art.paperOpacity;
  return selection;
}

function historicalWording(
  input: RenderedCardInput,
  prepared: PreparedCard,
  index: number,
): RenderedCardInput {
  if (prepared.gameplay || prepared.cosmetics?.wording !== "original") return input;
  if (input.layout === "art_series" || input.layout === "front_card") {
    throw new Error("Scan-backed faces retain their selected printed wording.");
  }
  const original = prepared.printing[index]?.originalWording;
  if (!original) throw new Error("Original wording is unavailable for this printing face.");
  return withCardWording(
    input,
    {
      oracle: {
        typeLine: input.typeLine ?? "",
        rulesText: input.rulesText ?? "",
        rulesParagraphs: input.rulesParagraphs,
      },
      original,
    },
    "original",
    { symbolStyle: input.symbolStyle },
  );
}

function resolveFace(input: RenderedCardInput, selection: PrintingSelection): SemanticCardInput {
  if (
    selection.preset === "match" &&
    !selection.art &&
    !Object.values(selection.overrides ?? {}).some((value) => value !== undefined)
  ) {
    return input;
  }
  const stamp = selection.overrides?.securityStamp;
  if (stamp && stamp !== "none" && stamp !== "oval") {
    throw new Error("Card Glint currently renders only oval security stamps.");
  }
  if (isSemanticLayout(input)) {
    const allowed =
      input.layout === "art_series" || input.layout === "front_card"
        ? ["borderColor"]
        : ["artist", "collectorNumber", "borderColor"];
    const unsupported = Object.keys(selection.overrides ?? {}).filter(
      (key) => !allowed.includes(key),
    );
    if (unsupported.length) {
      throw new Error(
        `The native ${input.layout} painter does not support ${unsupported.join(", ")} overrides.`,
      );
    }
  }
  const resolved = resolvePrintingPreset(input, selection);
  if (
    stamp === "oval" &&
    !magic.describe({ ...resolved, securityStampEffect: "holographic" }, "inspect").hologram
  ) {
    throw new Error("This native printing painter does not render an oval security stamp.");
  }
  return {
    ...resolved,
    ...((input.layout === "art_series" || input.layout === "front_card") &&
    selection.overrides?.borderColor
      ? { scanBorder: true }
      : {}),
    ...(selection.overrides?.styleSetCode ? { colorCalibration: "set-hsb-v1" as const } : {}),
    illustration: input.illustration,
    textInk: input.textInk,
  };
}

export function resolveCardPrinting(
  baseline: SemanticCardInput,
  prepared: PreparedCard,
): SemanticCardInput {
  if (prepared.cosmetics?.printing && prepared.cosmetics.printing.version !== 1) {
    throw new Error("Unsupported printing selection version.");
  }
  if (
    (prepared.cosmetics?.printing?.faces?.length ?? 0) > (prepared.snapshot.card_faces?.length ?? 1)
  ) {
    throw new Error("This printing does not have the selected appearance face.");
  }
  if (!baseline.faces?.length) {
    const worded = historicalWording(baseline, prepared, prepared.faceIndex);
    const resolved = resolveFace(
      worded,
      selectionFor(prepared.cosmetics?.printing, prepared.faceIndex, prepared.cosmetics?.border),
    );
    return { ...resolved, typeLine: worded.typeLine };
  }
  const faces = baseline.faces.map((child, index) => {
    if (prepared.cosmetics?.printing?.faces?.[index]?.overrides?.securityStamp !== undefined) {
      throw new Error("Security stamps apply to the whole printed card, not individual panels.");
    }
    if (
      isSemanticLayout(baseline) &&
      Object.keys(prepared.cosmetics?.printing?.faces?.[index]?.overrides ?? {}).some(
        (key) => key !== "artist",
      )
    ) {
      throw new Error(
        `The native ${baseline.layout} painter supports only artist overrides per face.`,
      );
    }
    const selection = selectionFor(prepared.cosmetics?.printing, index, prepared.cosmetics?.border);
    const context = { ...child, layout: baseline.layout, faces: baseline.faces };
    const resolved = resolveFace(context, selection);
    const panel = baseline.layout === "split" ? (resolved.faces?.[index] ?? resolved) : resolved;
    return historicalWording(
      {
        ...panel,
        faces: undefined,
        layout: child.layout,
        typeLine: child.typeLine,
        illustration: child.illustration,
        textInk: child.textInk,
      },
      prepared,
      index,
    );
  });
  if (baseline.layout === "split") {
    const layouts = faces.map(
      (face) => splitPanels({ ...face, layout: "split", faces })[0]?.face.layout,
    );
    if (layouts.some((layout) => layout !== layouts[0])) {
      throw new Error("Both split-card panels must use the same printing frame family.");
    }
  }
  return { ...faces[0]!, layout: baseline.layout, faces, reverseStats: baseline.reverseStats };
}
