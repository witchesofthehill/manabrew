import { getPlatformType } from "@/platform";

interface KeyboardLock {
  lock: (keys: string[]) => Promise<void>;
  unlock: () => void;
}

interface FullscreenSession {
  entered: boolean;
  keyboard?: KeyboardLock;
  cleanup: () => void;
}

let currentSession: FullscreenSession | null = null;

function releaseSession(session: FullscreenSession): void {
  if (currentSession !== session) return;
  currentSession = null;
  session.cleanup();
  session.keyboard?.unlock();
}

function getKeyboardLock(): KeyboardLock | undefined {
  if (getPlatformType() !== "web") return;
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
  if (typeof keyboard?.lock === "function" && typeof keyboard.unlock === "function") {
    return keyboard;
  }
}

async function enterFullscreen(): Promise<void> {
  if (currentSession && !currentSession.entered) return;
  if (currentSession) releaseSession(currentSession);
  const element = document.documentElement;
  if (typeof element.requestFullscreen !== "function") return;

  const session: FullscreenSession = {
    entered: false,
    cleanup: () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("pagehide", onPageHide);
    },
  };
  function onFullscreenChange(): void {
    if (session.entered && document.fullscreenElement !== element) releaseSession(session);
  }
  function onPageHide(): void {
    releaseSession(session);
  }
  currentSession = session;
  document.addEventListener("fullscreenchange", onFullscreenChange);
  window.addEventListener("pagehide", onPageHide);

  try {
    await element.requestFullscreen();
    session.entered = true;
    if (currentSession !== session || document.fullscreenElement !== element) {
      releaseSession(session);
      return;
    }
    const keyboard = getKeyboardLock();
    if (!keyboard) return;
    session.keyboard = keyboard;
    await keyboard.lock(["Escape"]);
    if (currentSession === session) {
      if (document.fullscreenElement !== element) releaseSession(session);
    } else if (!currentSession?.keyboard) {
      keyboard.unlock();
    }
  } catch {
    if (!session.entered || document.fullscreenElement !== element) releaseSession(session);
  }
}

export function toggleBrowserFullscreen(): void {
  if (typeof document === "undefined") return;
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  } else {
    void enterFullscreen();
  }
}
