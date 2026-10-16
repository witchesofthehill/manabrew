import { useId, useRef, useState } from "react";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { CardGlintInspect } from "@/components/editor/CardGlintInspect";
import { executeDeckEdit } from "@/components/editor/deckEditor.history";
import { normalizeCardCosmetics } from "@/lib/cardCosmetics";
import {
  CARD_FINISH_PRESETS,
  CARD_FRAME_PRESETS,
  CARD_BORDER_PRESETS,
  CARD_WEAR_PRESETS,
} from "@/lib/cardFinish";
import { supportsRetroCardFrame } from "@/lib/cardRenderDecision";
import { useDeckStore } from "@/stores/useDeckStore";
import { resolveTokenCustomizationScript, useCard } from "@/stores/useScryfallStore";
import { isTwoFaceLayout } from "@/lib/cardLayout";
import type { DeckCard } from "@/protocol/deck";
export function CardCustomizerModal({
  card,
  token = false,
  onClose,
}: {
  card: DeckCard;
  token?: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => normalizeCardCosmetics(card.identity.cosmetics));
  const wearSeed = useRef(card.identity.cosmetics?.wearSeed);
  const labelId = useId();
  const isReadOnly = useDeckStore((state) => state.isReadOnly);
  const editorSessionId = useDeckStore((state) => state.editorSessionId);
  const [sessionId] = useState(editorSessionId);
  const canEdit = !isReadOnly && sessionId === editorSessionId;
  const tokenSupported = !token || !!resolveTokenCustomizationScript(card);
  const printing = useCard({
    name: card.identity.name,
    setCode: card.identity.setCode || undefined,
    cardNumber: card.identity.cardNumber || undefined,
  });
  const layout = printing?.info.layout ?? card.layout;
  const faces =
    printing?.info.card_faces ??
    (card.backFace
      ? [{ type_line: card.backFace.typeLine, oracle_text: card.backFace.oracleText }]
      : []);
  const needsBack = card.isDoubleFaced || isTwoFaceLayout(layout);
  const retroCompatible =
    supportsRetroCardFrame(card) &&
    (!needsBack || !!card.backFace || (printing?.info.card_faces?.length ?? 0) > 1) &&
    faces.every((face) =>
      supportsRetroCardFrame({
        layout,
        types: (face.type_line ?? "").split(/[^A-Za-z]+/),
        subtypes: [],
        text: face.oracle_text ?? "",
      }),
    );
  const canSave =
    canEdit && (tokenSupported || !draft) && (draft?.frame !== "retro" || retroCompatible);
  const preview = { ...card, identity: { ...card.identity, cosmetics: draft } };
  const update = (field: "finish" | "frame" | "border" | "wear", value: string) => {
    if (field === "wear" && value !== "fresh" && wearSeed.current === undefined) {
      wearSeed.current = crypto.getRandomValues(new Uint32Array(1))[0];
    }
    setDraft((current) =>
      normalizeCardCosmetics({
        ...current,
        [field]: value === "printing" ? undefined : value,
        ...(field === "wear" ? { wearSeed: value === "fresh" ? undefined : wearSeed.current } : {}),
      }),
    );
  };
  const controls = [
    {
      field: "finish",
      label: "Finish",
      presets: CARD_FINISH_PRESETS,
      value: draft?.finish ?? "printing",
    },
    {
      field: "frame",
      label: "Frame",
      presets: CARD_FRAME_PRESETS,
      value: draft?.frame ?? "printing",
    },
    {
      field: "border",
      label: "Border",
      presets: CARD_BORDER_PRESETS,
      value: draft?.border ?? "printing",
    },
    { field: "wear", label: "Wear", presets: CARD_WEAR_PRESETS, value: draft?.wear ?? "fresh" },
  ] as const;

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl" ariaLabel={`Customize ${card.identity.name}`}>
      <Modal.Header>
        <div>
          <h2 className="text-base font-semibold">Customize card</h2>
          <p className="text-sm text-muted-foreground">{card.identity.name}</p>
        </div>
      </Modal.Header>
      <Modal.Body className="overflow-y-auto">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.7fr)]">
          <CardGlintInspect
            card={preview}
            className="min-h-64 rounded-lg border bg-muted/20 sm:min-h-96"
          />
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <p className="font-medium">
                {token ? "This deck's token appearance" : "This copy only"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {token
                  ? "Applies to this token type produced by this deck. Other token types stay unchanged."
                  : "Saves one copy from this tile. Other copies and printings stay unchanged."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {card.identity.setCode.toUpperCase()} #{card.identity.cardNumber}
                {card.identity.foil ? " · Physical foil" : " · Physical nonfoil"}
              </p>
            </div>
            {controls.map(({ field, label, presets, value }) => (
              <div key={field} className="space-y-1.5">
                <label id={`${labelId}-${field}`} className="block text-sm font-medium">
                  {label}
                </label>
                <AppSelect
                  value={value}
                  onValueChange={(next) => update(field, next)}
                  aria-labelledby={`${labelId}-${field}`}
                  disabled={!canEdit || !tokenSupported}
                  className="w-full"
                >
                  {field === "finish" && (
                    <AppSelectOption value="printing">Printing default</AppSelectOption>
                  )}
                  {presets.map(({ id, label: presetLabel }) => (
                    <AppSelectOption
                      key={id}
                      value={id}
                      disabled={field === "frame" && id === "retro" && !retroCompatible}
                    >
                      {presetLabel}
                    </AppSelectOption>
                  ))}
                </AppSelect>
              </div>
            ))}
            {!retroCompatible && (
              <p className="text-xs text-muted-foreground">
                Retro frames are unavailable for this card's layout.
              </p>
            )}
            {!tokenSupported && (
              <p role="status" className="text-xs text-warning">
                This token has no unambiguous engine token mapping. Custom appearance cannot be
                saved for multiplayer.
              </p>
            )}
            {tokenSupported && token && (
              <p className="text-xs text-muted-foreground">
                Token appearance is supported by Forge, the Rust engine, and manual games. Ironsmith
                cannot yet match these token definitions.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Appearance only. Your printing, physical foil, and card rules do not change.
            </p>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline" disabled={!canEdit} onClick={() => setDraft(undefined)}>
          Reset to printing
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={() => {
              if (!canSave) return;
              executeDeckEdit(`Customize ${card.identity.name}`, () => {
                useDeckStore.getState().setCardCosmetics(card, draft, token);
              });
              onClose();
            }}
          >
            Save
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
