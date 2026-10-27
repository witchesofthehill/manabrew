import { CardCustomizerQuantity } from "@/components/editor/CardCustomizerQuantity";
import { CardCustomizerControls } from "@/components/editor/CardCustomizerControls";
import type { CardCustomizerEditor } from "@/components/editor/useCardCustomizerDraft";

export function CardCustomizerSettings({
  editor,
  token,
  canEdit,
  available,
  sessionValid,
  tokenSupported,
  retroIds,
  pendingRetroCompatible,
}: {
  editor: CardCustomizerEditor;
  token: boolean;
  canEdit: boolean;
  available: number;
  sessionValid: boolean;
  tokenSupported: boolean;
  retroIds: ReadonlySet<string> | undefined;
  pendingRetroCompatible: boolean;
}) {
  const selectedRetroCompatible =
    editor.selected.length > 0 && editor.selected.every((copy) => retroIds?.has(copy.identity.id));
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/20 p-3 text-ui-body" aria-live="polite">
        <p className="font-medium">
          {token
            ? "This deck's token appearance"
            : `${editor.selected.length} selected · ${editor.pending.length} pending`}
        </p>
        <p className="mt-1 text-ui-body text-muted-foreground">
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
        <p role="status" className="text-ui-meta text-warning">
          {!sessionValid
            ? "The deck session changed. Close and reopen this customizer."
            : editor.stale
              ? "A pending copy changed or was removed. Close and reopen to edit the current deck."
              : "This copy is no longer available in the deck."}
        </p>
      )}
      {!selectedRetroCompatible && (
        <p className="text-ui-meta text-muted-foreground">
          {!retroIds
            ? "Checking frame compatibility…"
            : "Retro frames are unavailable for one or more selected copies or faces."}
        </p>
      )}
      {!pendingRetroCompatible && (
        <p role="status" className="text-ui-meta text-warning">
          A pending retro frame is not supported by its copy. Select that copy and choose another
          frame before saving.
        </p>
      )}
      {!tokenSupported && (
        <p role="status" className="text-ui-meta text-warning">
          This token has no unambiguous engine token mapping. Custom appearance cannot be saved for
          multiplayer.
        </p>
      )}
      {tokenSupported && token && (
        <p className="text-ui-body text-muted-foreground">
          Token appearance is supported by Forge, the Rust engine, and manual games. Ironsmith
          cannot yet match these token definitions.
        </p>
      )}
    </div>
  );
}
