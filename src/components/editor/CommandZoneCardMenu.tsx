import type { ReactNode } from "react";

import { CardContextMenu } from "./DeckListView";

export interface CommandZoneCardMenuActions {
  commanderLabel: string;
  customTags: string[];
  appliedTags: string[];
  isFoil: boolean;
  isCover: boolean;
  isCoverBack: boolean;
  hasBackFace: boolean;
  onShowInfo: () => void;
  onRemoveCommander: () => void;
  onPickPrint: () => void;
  onToggleFoil: () => void;
  onSetCover: () => void;
  onSetCoverBack: () => void;
  onApplyTag: (tag: string) => void;
  onCreateTag: (tag: string) => void;
}

export function CommandZoneCardMenu({
  children,
  actions,
}: {
  children: ReactNode;
  actions: CommandZoneCardMenuActions;
}) {
  return (
    <CardContextMenu
      count={1}
      location="main"
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
      onToggleFoil={actions.onToggleFoil}
      isFoil={actions.isFoil}
    >
      {children}
    </CardContextMenu>
  );
}
