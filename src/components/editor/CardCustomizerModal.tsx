import { useState } from "react";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { CardCustomizerSettings } from "@/components/editor/CardCustomizerSettings";
import { CardGlintInspect } from "@/components/editor/CardGlintInspect";
import { GeneratedCardImage } from "@/components/game/GeneratedCardImage";
import { isFeatureEnabled } from "@/featureFlags";
import { CardPrintingPicker } from "@/components/editor/CardPrintingPicker";
import { useCardCustomizerDraft } from "@/components/editor/useCardCustomizerDraft";
import { useCardCustomizerEligibility } from "@/components/editor/useCardCustomizerEligibility";
import { customizationSourceChanged } from "@/components/editor/cardCustomizerDraft";
import { executeDeckEdit } from "@/components/editor/deckEditor.history";
import { deriveTokens } from "@/lib/decks";
import { getCardCustomizationCopy, useDeckStore } from "@/stores/useDeckStore";
import { resolveTokenCustomizationScript, tokenIdentityKey } from "@/stores/useScryfallStore";
import type { DeckCard } from "@/protocol/deck";
import type { EditorDeck } from "@/types/manabrew";

function getTokenCustomizationCopy(deck: EditorDeck, card: DeckCard): DeckCard | undefined {
  const key = tokenIdentityKey(card);
  const produced = deriveTokens(deck).find((copy) => tokenIdentityKey(copy) === key);
  if (!produced) return undefined;
  return deck.tokens?.find((copy) => tokenIdentityKey(copy) === key) ?? produced;
}

export function CardCustomizerModal({
  card,
  token = false,
  onClose,
}: {
  card: DeckCard;
  token?: boolean;
  onClose: () => void;
}) {
  const isReadOnly = useDeckStore((state) => state.isReadOnly);
  const editorSessionId = useDeckStore((state) => state.editorSessionId);
  const currentDeck = useDeckStore((state) => state.currentDeck);
  const [opening] = useState({ sessionId: editorSessionId, cardId: card.identity.id, token });
  const editor = useCardCustomizerDraft(currentDeck, card, token);
  const retroCompatible = useCardCustomizerEligibility(editor.preview);
  const sessionValid =
    opening.sessionId === editorSessionId &&
    opening.cardId === card.identity.id &&
    opening.token === token;
  const canEdit = !isReadOnly && sessionValid && !!editor.active && !editor.stale;
  const tokenSupported = !token || !!resolveTokenCustomizationScript(editor.active ?? card);
  const frameSupported = editor.draft?.cosmetics?.frame !== "retro" || retroCompatible === true;
  const canSave =
    canEdit && editor.pending && frameSupported && (tokenSupported || !editor.draft?.cosmetics);
  const save = () => {
    const draft = editor.draft;
    if (!canSave || !draft) return;
    const state = useDeckStore.getState();
    if (
      state.isReadOnly ||
      state.editorSessionId !== opening.sessionId ||
      card.identity.id !== opening.cardId ||
      token !== opening.token
    )
      return;
    const current = token
      ? getTokenCustomizationCopy(state.currentDeck, card)
      : getCardCustomizationCopy(state.currentDeck, opening.cardId);
    if (
      !current ||
      customizationSourceChanged(draft.source, current) ||
      (token && draft.cosmetics && !resolveTokenCustomizationScript(current))
    )
      return;
    executeDeckEdit(`Customize ${card.identity.name}`, () => {
      if (token) state.setTokenCosmetics(current, draft.cosmetics, draft.foil, draft.printing);
      else
        state.setCardCosmetics([
          {
            cardId: current.identity.id,
            cosmetics: draft.cosmetics,
            foil: draft.foil,
            printing: draft.printing,
          },
        ]);
    });
    onClose();
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-7xl" ariaLabel={`Customize ${card.identity.name}`}>
      <Modal.Header>
        <div>
          <h2 className="text-ui-body font-semibold">Customize card</h2>
          <p className="text-ui-label text-muted-foreground">{card.identity.name}</p>
        </div>
      </Modal.Header>
      <Modal.Body className="overflow-y-auto">
        <div className="grid items-start gap-5 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="min-w-0">
            {isFeatureEnabled("cardFoil") ? (
              <CardGlintInspect
                card={editor.preview}
                className="min-h-64 rounded-lg border bg-muted/20 sm:min-h-96"
              />
            ) : (
              <GeneratedCardImage deckCard={editor.preview} className="w-full rounded-lg" />
            )}
            <p className="mt-2 text-ui-meta text-muted-foreground">
              {editor.preview.identity.setCode.toUpperCase()} #{editor.preview.identity.cardNumber}
              {editor.preview.identity.foil ? " · Foil" : " · Nonfoil"}
            </p>
          </div>
          <CardCustomizerSettings
            editor={editor}
            token={token}
            canEdit={canEdit}
            sessionValid={sessionValid}
            tokenSupported={tokenSupported}
            retroCompatible={retroCompatible}
            frameSupported={frameSupported}
          />
        </div>
        <section aria-label="Printings" className="mt-5 min-w-0 space-y-3 border-t pt-4">
          <h3 className="text-ui-label font-semibold">Printings</h3>
          <p className="text-ui-body text-muted-foreground" aria-live="polite">
            {token
              ? "Choose a printing for this deck's token type."
              : "Choose a printing for this card."}
            {" Changes apply only when you save."}
          </p>
          <CardPrintingPicker
            cardName={card.identity.name}
            token={token ? (editor.active ?? card) : undefined}
            printing={editor.preview.identity}
            layout="row"
            disabled={!canEdit}
            onSelect={(printing) => {
              if (canEdit) editor.editPrinting(printing);
            }}
          />
        </section>
      </Modal.Body>
      <Modal.Footer className="flex-wrap gap-2">
        <Button variant="outline" disabled={!canEdit} onClick={editor.reset}>
          Reset to printing
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={save}>
            Save
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
