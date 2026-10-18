import type { ReactNode } from "react";
import type { DeckCard } from "@/protocol/deck";

import { CardContextMenu } from "./DeckListView";

export interface CommandZoneCardMenuActions {
  canCustomize: boolean;
  commanderLabel: string;
  customTags: string[];
  appliedTags: string[];
  isCover: boolean;
  isCoverBack: boolean;
  hasBackFace: boolean;
  onShowInfo: () => void;
  onRemoveCommander: () => void;
  onPickPrint: () => void;
  onSetCover: () => void;
  onSetCoverBack: () => void;
  onApplyTag: (tag: string) => void;
  onCreateTag: (tag: string) => void;
}

export function CommandZoneCardMenu({
  children,
  card,
  actions,
}: {
  children: ReactNode;
  card: DeckCard;
  actions: CommandZoneCardMenuActions;
}) {
  return (
    <CardContextMenu
      card={card}
      count={1}
      location="main"
      canCustomize={actions.canCustomize}
      onShowInfo={actions.onShowInfo}
      isCommander
      commanderSlot={{ noun: actions.commanderLabel, icon: "crown" }}
      onRemoveCommander={actions.onRemoveCommander}
      isCover={actions.isCover}
      onSetCover={actions.onSetCover}
      isCoverBack={actions.isCoverBack}
      onSetCoverBack={actions.hasBackFace ? actions.onSetCoverBack : undefined}
      customTags={actions.customTags}
      appliedTags={actions.appliedTags}
      onApplyTag={actions.onApplyTag}
      onCreateTag={actions.onCreateTag}
      onPickPrint={actions.onPickPrint}
    >
      {children}
    </CardContextMenu>
  );
}
