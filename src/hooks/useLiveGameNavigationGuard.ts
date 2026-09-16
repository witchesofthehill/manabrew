import { useBlocker } from "react-router-dom";

/**
 * Holds browser history navigation (mouse side buttons, trackpad swipe,
 * alt+arrow) while a game is live. A back press used to unmount the board and
 * hide the nav chrome with it, and browser forward then re-mounted `Play`,
 * which relaunched the game and read the store's refusal as a failed start —
 * the host ended the table (#892). Only POP is held: the app's own navigations
 * (game over, leave, gauntlet) keep working. Entries the router did not create
 * (a reload, a typed URL) cannot be held; `useEngineHostCloseGuard` covers the
 * unload side for hosts.
 */
export function useLiveGameNavigationGuard(live: boolean) {
  return useBlocker(({ historyAction }) => live && historyAction === "POP");
}
