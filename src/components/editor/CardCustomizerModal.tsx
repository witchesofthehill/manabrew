import { useMemo, useState } from "react";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { CardCustomizerQuantity } from "@/components/editor/CardCustomizerQuantity";
import { CardGlintInspect } from "@/components/editor/CardGlintInspect";
import { CardCustomizerCopies } from "@/components/editor/CardCustomizerCopies";
import { CardCustomizerControls } from "@/components/editor/CardCustomizerControls";
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
  const retroIds = useCardCustomizerEligibility(editor.copies);
  const sessionValid = opening.sessionId === editorSessionId && opening.cardId === card.identity.id;
  const available = token ? Number(!!tokenCopy) : editor.copies.length;
  const canEdit = !isReadOnly && sessionValid && available > 0 && !editor.stale;
  const tokenSupported = !token || !!resolveTokenCustomizationScript(tokenCopy ?? card);
  const selectedRetroCompatible =
    editor.selected.length > 0 && editor.selected.every((copy) => retroIds?.has(copy.identity.id));
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
        state.setTokenCosmetics(current[0]!, draft.cosmetics, draft.foil);
      } else
        state.setCardCosmetics(
          editor.pending.map(([cardId, draft]) => ({
            cardId,
            cosmetics: draft.cosmetics,
            foil: draft.foil,
          })),
        );
    });
    onClose();
  };

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
          <div className="min-w-0">
            <CardGlintInspect
              card={editor.preview}
              className="min-h-64 rounded-lg border bg-muted/20 sm:min-h-96"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {editor.preview.identity.setCode.toUpperCase()} #{editor.preview.identity.cardNumber}
              {editor.preview.identity.foil ? " · Foil" : " · Nonfoil"}
            </p>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3 text-sm" aria-live="polite">
              <p className="font-medium">
                {token
                  ? "This deck's token appearance"
                  : `${editor.selected.length} selected · ${editor.pending.length} pending`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {token
                  ? "Applies to this token type produced by this deck. Other token types stay unchanged."
                  : "Click a copy to inspect and select it. Check copies to edit them together. Pending changes stay when you switch copies."}
              </p>
            </div>
            {!token && editor.copies.length > 1 && (
              <CardCustomizerQuantity
                value={editor.selected.length}
                max={available}
                disabled={!canEdit}
                onChange={editor.selectQuantity}
              />
            )}
            <CardCustomizerControls
              selected={editor.selected}
              drafts={editor.drafts}
              disabled={!canEdit || !editor.active || !tokenSupported}
              retroCompatible={selectedRetroCompatible}
              onChange={(field, value) => {
                if (canEdit && (field !== "frame" || value !== "retro" || selectedRetroCompatible))
                  editor.editSelected(field, value);
              }}
            />
            {(!sessionValid || editor.stale || !available || !editor.active) && (
              <p role="status" className="text-xs text-warning">
                {!sessionValid
                  ? "The deck session changed. Close and reopen this customizer."
                  : editor.stale
                    ? "A pending copy changed or was removed. Close and reopen to edit the current deck."
                    : "This copy is no longer available in the deck."}
              </p>
            )}
            {!selectedRetroCompatible && (
              <p className="text-xs text-muted-foreground">
                {!retroIds
                  ? "Checking frame compatibility…"
                  : "Retro frames are unavailable for one or more selected copies or faces."}
              </p>
            )}
            {!pendingRetroCompatible && (
              <p role="status" className="text-xs text-warning">
                A pending retro frame is not supported by its copy. Select that copy and choose
                another frame before saving.
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
              Foil state follows the selected finish. Your printing and card rules do not change.
            </p>
          </div>
        </div>
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
