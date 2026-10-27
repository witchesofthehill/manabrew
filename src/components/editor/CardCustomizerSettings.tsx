import { CardCustomizerControls } from "@/components/editor/CardCustomizerControls";
import type { CardCustomizerEditor } from "@/components/editor/useCardCustomizerDraft";

export function CardCustomizerSettings({
  editor,
  token,
  canEdit,
  sessionValid,
  tokenSupported,
  retroCompatible,
  frameSupported,
}: {
  editor: CardCustomizerEditor;
  token: boolean;
  canEdit: boolean;
  sessionValid: boolean;
  tokenSupported: boolean;
  retroCompatible: boolean | undefined;
  frameSupported: boolean;
}) {
  return (
    <div className="space-y-4">
      {token && (
        <div className="rounded-lg border bg-muted/20 p-3 text-ui-body">
          <p className="font-medium">This deck's token appearance</p>
          <p className="mt-1 text-ui-body text-muted-foreground">
            Applies to this token type produced by this deck. Other token types stay unchanged.
          </p>
        </div>
      )}
      <CardCustomizerControls
        cosmetics={editor.preview.identity.cosmetics}
        disabled={!canEdit || !editor.active || !tokenSupported}
        retroCompatible={retroCompatible === true}
        onChange={(field, value) => {
          if (canEdit && (field !== "frame" || value !== "retro" || retroCompatible === true))
            editor.edit(field, value);
        }}
      />
      {(!sessionValid || editor.stale || !editor.active) && (
        <p role="status" className="text-ui-meta text-warning">
          {!sessionValid
            ? "The deck session changed. Close and reopen this customizer."
            : editor.stale
              ? "This card changed or was removed. Close and reopen to edit the current deck."
              : "This card is no longer available in the deck."}
        </p>
      )}
      {retroCompatible !== true && (
        <p className="text-ui-meta text-muted-foreground">
          {retroCompatible === undefined
            ? "Checking frame compatibility…"
            : "Retro frames are unavailable for this card or one of its faces."}
        </p>
      )}
      {editor.pending && !frameSupported && (
        <p role="status" className="text-ui-meta text-warning">
          This card does not support its retro frame. Choose another frame before saving.
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
