import { AuthRequestError, requestGuestToken } from "@/api/auth";
import { isFeatureEnabled } from "@/featureFlags";
import { deviceSecret } from "@/lib/relayIdentity";
import { ensureUsernameTag } from "@/lib/username";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export function isNameClaimedError(err: unknown): boolean {
  return err instanceof AuthRequestError && err.status === 409;
}

export async function reserveGuestName(base: string): Promise<void> {
  const name = base.trim();
  if (!name) throw new Error("Enter a name.");
  const prefs = usePreferencesStore.getState();
  if (isFeatureEnabled("accounts")) {
    const device = deviceSecret();
    if (!device) throw new Error("This browser can't store an identity (enable local storage).");
    await requestGuestToken(ensureUsernameTag(name, prefs.serverUsername), device);
  }
  prefs.setServerUsername(name);
}
