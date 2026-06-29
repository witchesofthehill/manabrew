import { useGameUIStore } from "@/stores/useGameUIStore";
import { useGameStore } from "@/stores/useGameStore";
import { Children, type ReactNode, useEffect, useMemo } from "react";
import { PromptModalChromeContext } from "@/components/game/modals/promptModalChrome.context";

interface PromptModalControllerProps {
  isActive: boolean;
  promptStateKey: unknown;
  children: ReactNode;
}

export function PromptModalController({
  isActive,
  promptStateKey,
  children,
}: PromptModalControllerProps) {
  const promptModalHidden = useGameUIStore((s) => s.promptModalHidden);
  const showPromptModal = useGameUIStore((s) => s.showPromptModal);
  const hidePromptModal = useGameUIStore((s) => s.hidePromptModal);
  const isWaitingForResponse = useGameStore((s) => s.isWaitingForResponse);

  const activeChildren = useMemo(() => Children.toArray(children).filter(Boolean), [children]);

  const isOpen = !promptModalHidden;

  useEffect(() => {
    if (isActive) {
      showPromptModal();
    }
  }, [isActive, promptStateKey, showPromptModal]);

  if (!isActive || isWaitingForResponse) {
    return null;
  }

  if (activeChildren.length !== 1) {
    throw new Error(
      `PromptModalController expected exactly 1 active modal child, got ${activeChildren.length}`,
    );
  }

  if (!isOpen) {
    return null;
  }

  return (
    <PromptModalChromeContext.Provider value={{ showMinimize: true, onMinimize: hidePromptModal }}>
      {activeChildren[0]}
    </PromptModalChromeContext.Provider>
  );
}
