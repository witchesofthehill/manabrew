import { useEffect, useState } from "react";
import {
  resolveCardPrintingCalibration,
  type CardCalibrationResolution,
} from "@/lib/cardPrintingCalibration";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { DeckCard } from "@/protocol/deck";

export interface CardCustomizerCalibrationState {
  pending: boolean;
  valid: boolean;
  resolution?: CardCalibrationResolution;
  error?: string;
}

export function useCardCustomizerCalibration(card: DeckCard): CardCustomizerCalibrationState {
  const locale = useScryfallStore((state) => state.locale);
  const key = JSON.stringify([card, locale]);
  const printing = card.identity.cosmetics?.printing;
  const explicit =
    printing?.overrides?.calibration !== undefined ||
    !!printing?.faces?.some((face) => face.overrides?.calibration !== undefined);
  const [resolved, setResolved] = useState<{
    key: string;
    resolution?: CardCalibrationResolution;
    error?: string;
  }>();
  useEffect(() => {
    let alive = true;
    void resolveCardPrintingCalibration(card).then(
      (resolution) => {
        if (alive) setResolved({ key, resolution });
      },
      (cause: unknown) => {
        if (alive)
          setResolved({
            key,
            error:
              cause instanceof Error ? cause.message : "Calibration coverage could not be loaded.",
          });
      },
    );
    return () => {
      alive = false;
    };
  }, [card, key]);
  if (resolved?.key !== key) return { pending: true, valid: !explicit };
  return {
    pending: false,
    valid: !explicit || resolved.resolution?.valid === true,
    resolution: resolved.resolution,
    error: resolved.error,
  };
}
