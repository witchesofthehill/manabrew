import { Redo2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { redoDeckEdit, undoDeckEdit, useDeckHistoryState } from "./deckEditor.history";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";

export function DeckHistoryControls() {
  const history = useDeckHistoryState();

  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border">
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 rounded-none border-r"
        disabled={!history.undoLabel}
        title={
          history.undoLabel ? i18n._(msg`Undo ${history.undoLabel}`) : i18n._(msg`Nothing to undo`)
        }
        onClick={undoDeckEdit}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 rounded-none"
        disabled={!history.redoLabel}
        title={
          history.redoLabel ? i18n._(msg`Redo ${history.redoLabel}`) : i18n._(msg`Nothing to redo`)
        }
        onClick={redoDeckEdit}
      >
        <Redo2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
