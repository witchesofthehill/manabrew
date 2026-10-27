import {
  printingCalibrationOptions,
  resolvePrintingCalibration,
  type PrintingCalibrationChoice,
  type PrintingCalibrationReport,
} from "card-glint/magic/presentation";
import { captureCardInput, prepareCard, type PreparedCard } from "@/lib/cardRenderSnapshot";
import { cardGlintFace } from "@/lib/cardRenderFace";
import { isSemanticLayout, type SemanticCardInput } from "@/lib/cardSemanticLayout";
import type { CardPrintingCalibration, CardPrintingFace, DeckCard } from "@/protocol/deck";

export interface CardCalibrationOption {
  value: CardPrintingCalibration;
  label: string;
  supported: boolean;
  reason?: string;
}

export interface CardCalibrationFace {
  index: 0 | 1;
  name: string;
  value?: CardPrintingCalibration;
  effective?: CardPrintingCalibration;
  options: CardCalibrationOption[];
  report?: PrintingCalibrationReport;
  restriction?: string;
  error?: string;
}

export interface CardCalibrationResolution {
  faces: CardCalibrationFace[];
  options: CardCalibrationOption[];
  valid: boolean;
  errors: string[];
}

export const CARD_CALIBRATION_CHOICES: readonly CardCalibrationOption[] = [
  { value: "auto", label: "Automatic", supported: true },
  { value: "printing", label: "Exact printing", supported: true },
  { value: "source", label: "Source colors", supported: true },
  { value: "m21-modern", label: "Modern · M21 defaults", supported: false },
  { value: "8ed-eighth", label: "Eighth · 8ED defaults", supported: false },
];

function withoutCalibration(layer: CardPrintingFace): CardPrintingFace {
  if (!layer.overrides) return layer;
  const { calibration: _, ...overrides } = layer.overrides;
  return { ...layer, overrides };
}

function uncalibrated(prepared: PreparedCard): PreparedCard {
  const printing = prepared.cosmetics?.printing;
  if (!printing) return prepared;
  return {
    ...prepared,
    cosmetics: {
      ...prepared.cosmetics,
      printing: {
        ...printing,
        overrides: withoutCalibration(printing).overrides,
        faces: printing.faces?.map(withoutCalibration),
      },
    },
  };
}

function sdkChoice(value: CardPrintingCalibration): PrintingCalibrationChoice {
  return value === "m21-modern" || value === "8ed-eighth" ? { profile: value } : value;
}

function inspectFace(
  face: SemanticCardInput,
  index: 0 | 1,
  card: DeckCard,
  hostLayout?: string,
): CardCalibrationFace {
  const printing = card.identity.cosmetics?.printing;
  const value = printing?.faces?.[index]?.overrides?.calibration;
  const effective = value ?? printing?.overrides?.calibration;
  const restriction = hostLayout
    ? `The ${hostLayout} host compositor does not support calibration overrides.`
    : undefined;
  const named = printingCalibrationOptions(face);
  const options = CARD_CALIBRATION_CHOICES.map((option) => {
    const profile = named.find((candidate) => candidate.id === option.value);
    return {
      ...option,
      supported: !restriction && (profile?.supported ?? option.supported),
      reason: restriction ?? profile?.reason,
    };
  });
  const unsupported = effective && options.find((option) => option.value === effective);
  let error =
    unsupported && !unsupported.supported
      ? (unsupported.reason ?? "This calibration is incompatible with the selected face.")
      : undefined;
  let report: PrintingCalibrationReport | undefined;
  if (!restriction && !error) {
    try {
      report = resolvePrintingCalibration({
        ...face,
        ...(effective === undefined ? {} : { calibration: sdkChoice(effective) }),
      });
    } catch (cause) {
      error =
        cause instanceof Error ? cause.message : "Calibration coverage could not be resolved.";
    }
  }
  return { index, name: face.name, value, effective, options, report, restriction, error };
}

export async function resolveCardPrintingCalibration(
  card: DeckCard,
): Promise<CardCalibrationResolution> {
  const prepared = await prepareCard(captureCardInput({ deckCard: card }));
  const selected = cardGlintFace(uncalibrated(prepared), true).face;
  const hostLayout = isSemanticLayout(selected) ? (selected.layout ?? "semantic") : undefined;
  const faces: CardCalibrationFace[] = [];
  if (prepared.combined && selected.faces?.length) {
    for (const [index, face] of selected.faces.entries()) {
      if (index > 1) throw new Error("Calibration supports at most two printing faces.");
      faces.push(
        inspectFace(
          { ...face, layout: selected.layout, faces: selected.faces },
          index as 0 | 1,
          card,
          hostLayout,
        ),
      );
    }
  } else {
    faces.push(inspectFace(selected, 0, card, hostLayout));
    if ((prepared.snapshot.card_faces?.length ?? 1) > 1) {
      const reverse = await prepareCard(captureCardInput({ deckCard: card, faceIndex: 1 }));
      const face = cardGlintFace(uncalibrated(reverse), true).face;
      faces.push(
        inspectFace(
          face,
          1,
          card,
          isSemanticLayout(face) ? (face.layout ?? "semantic") : undefined,
        ),
      );
    }
  }
  const inheriting = faces.filter((face) => face.value === undefined);
  const options = CARD_CALIBRATION_CHOICES.map((option) => {
    const incompatible = inheriting.flatMap((face) => {
      const choice = face.options.find((candidate) => candidate.value === option.value);
      return choice?.supported
        ? []
        : [`${face.name}: ${choice?.reason ?? "Unavailable for this face."}`];
    });
    return {
      ...option,
      supported: incompatible.length === 0,
      reason: incompatible.join(" ") || undefined,
    };
  });
  const errors = faces.flatMap((face) => (face.error ? [`${face.name}: ${face.error}`] : []));
  if ((card.identity.cosmetics?.printing?.faces?.length ?? 0) > faces.length)
    errors.push(
      "This printing does not have the saved calibration override face. Reset to printing to remove it.",
    );
  return { faces, options, valid: errors.length === 0, errors };
}
