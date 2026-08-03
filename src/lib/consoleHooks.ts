import { useGameDevStore } from "@/stores/useGameDevStore";

declare global {
  interface Window {
    manabrewAllowIllegalDecks?: (enabled?: boolean) => void;
  }
}

export function registerConsoleHooks() {
  window.manabrewAllowIllegalDecks = (enabled = true) => {
    useGameDevStore.getState().setAllowIllegalDecks(enabled);
    console.info(
      enabled
        ? "[manabrew] deck legality gates bypassed for this session"
        : "[manabrew] deck legality gates restored",
    );
  };
}
