import { useMemo, useState } from "react";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { CardCustomizerSettings } from "@/components/editor/CardCustomizerSettings";
import { CardGlintInspect } from "@/components/editor/CardGlintInspect";
import { CardCustomizerCopies } from "@/components/editor/CardCustomizerCopies";
import { CardPrintingPicker } from "@/components/editor/CardPrintingPicker";
import { useCardCustomizerDraft } from "@/components/editor/useCardCustomizerDraft";
import { useCardCustomizerEligibility } from "@/components/editor/useCardCustomizerEligibility";
import { customizationSourceChanged } from "@/components/editor/cardCustomizerDraft";
import { executeDeckEdit } from "@/components/editor/deckEditor.history";
import { deriveTokens } from "@/lib/decks";
import { getCardCustomizationCopies, useDeckStore } from "@/stores/useDeckStore";
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
  const [opening] = useState({ sessionId: editorSessionId, cardId: card.identity.id });
  const tokenCopy = useMemo(
    () => (token ? getTokenCustomizationCopy(currentDeck, card) : undefined),
    [currentDeck, card, token],
  );
  const editor = useCardCustomizerDraft(currentDeck, tokenCopy ?? card, token);
  const retroIds = useCardCustomizerEligibility(editor.previewCopies);
  const sessionValid = opening.sessionId === editorSessionId && opening.cardId === card.identity.id;
  const available = token ? Number(!!tokenCopy) : editor.copies.length;
  const canEdit = !isReadOnly && sessionValid && available > 0 && !editor.stale;
  const tokenSupported = !token || !!resolveTokenCustomizationScript(tokenCopy ?? card);
  const pendingRetroCompatible = editor.pending.every(
    ([id, draft]) => draft.cosmetics?.frame !== "retro" || retroIds?.has(id),
  );
  const canSave =
    canEdit &&
    !!editor.active &&
    editor.pending.length > 0 &&
    pendingRetroCompatible &&
    (tokenSupported || editor.pending.every(([, draft]) => !draft.cosmetics));
  const save = () => {
    if (!canSave) return;
    const state = useDeckStore.getState();
    if (state.isReadOnly || state.editorSessionId !== opening.sessionId) return;
    const currentToken = token ? getTokenCustomizationCopy(state.currentDeck, card) : undefined;
    const current = token
      ? currentToken
        ? [currentToken]
        : []
      : getCardCustomizationCopies(state.currentDeck, card);
    if (
      editor.pending.some(([id, draft]) => {
        const copy = current.find((candidate) => candidate.identity.id === id);
        return !copy || customizationSourceChanged(draft.source, copy);
      })
    )
      return;
    executeDeckEdit(`Customize ${card.identity.name}`, () => {
      if (token) {
        const draft = editor.pending[0]![1];
        state.setTokenCosmetics(current[0]!, draft.cosmetics, draft.foil, draft.printing);
      } else
        state.setCardCosmetics(
          editor.pending.map(([cardId, draft]) => ({
            cardId,
            cosmetics: draft.cosmetics,
            foil: draft.foil,
            printing: draft.printing,
          })),
        );
    });
    onClose();
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl" ariaLabel={`Customize ${card.identity.name}`}>
      <Modal.Header>
        <div>
          <h2 className="text-ui-body font-semibold">Customize card</h2>
          <p className="text-ui-label text-muted-foreground non-touch:text-sm">
            {card.identity.name}
          </p>
        </div>
      </Modal.Header>
      <Modal.Body className="overflow-y-auto">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.7fr)]">
          <div className="min-w-0">
            <CardGlintInspect
              card={editor.preview}
              className="min-h-64 rounded-lg border bg-muted/20 sm:min-h-96"
            />
            <p className="mt-2 text-ui-meta text-muted-foreground non-touch:text-xs">
              {editor.preview.identity.setCode.toUpperCase()} #{editor.preview.identity.cardNumber}
              {editor.preview.identity.foil ? " · Foil" : " · Nonfoil"}
            </p>
          </div>
          <CardCustomizerSettings
            editor={editor}
            token={token}
            canEdit={canEdit}
            available={available}
            sessionValid={sessionValid}
            tokenSupported={tokenSupported}
            retroIds={retroIds}
            pendingRetroCompatible={pendingRetroCompatible}
          />
        </div>
        <section aria-label="Printings" className="mt-5 min-w-0 space-y-3 border-t pt-4">
          <h3 className="text-ui-label font-semibold non-touch:text-sm">Printings</h3>
          <p className="text-ui-body text-muted-foreground non-touch:text-xs" aria-live="polite">
            {token
              ? "Choose a printing for this deck's token type."
              : `Choose a printing for ${editor.selected.length} selected ${editor.selected.length === 1 ? "copy" : "copies"}.`}
            {" Changes apply only when you save."}
          </p>
          <CardPrintingPicker
            cardName={card.identity.name}
            token={token ? (tokenCopy ?? card) : undefined}
            printing={editor.preview.identity}
            layout="row"
            disabled={!canEdit || !editor.active || editor.selected.length === 0}
            onSelect={(printing) => {
              if (canEdit) editor.editPrinting(printing);
            }}
          />
        </section>
        {!token && (
          <CardCustomizerCopies
            deck={currentDeck}
            copies={editor.copies}
            activeId={editor.activeId}
            selectedIds={editor.selectedIds}
            pendingIds={editor.pendingIds}
            drafts={editor.drafts}
            disabled={isReadOnly || !sessionValid}
            onSelect={editor.selectCopy}
            onToggle={editor.toggleCopy}
          />
        )}
      </Modal.Body>
      <Modal.Footer className="flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!canEdit || editor.selected.length === 0}
          onClick={editor.resetSelected}
        >
          Reset to printing
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={save}>
            Save
            {!token && editor.pending.length > 0
              ? ` ${editor.pending.length} ${editor.pending.length === 1 ? "change" : "changes"}`
              : ""}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
