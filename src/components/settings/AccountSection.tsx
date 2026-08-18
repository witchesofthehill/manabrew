import { useState } from "react";
import { toast } from "sonner";
import { Github, Link2, Mail, Pencil, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DiscordIcon } from "@/components/icons/DiscordIcon";
import { HandleDialog } from "@/components/auth/HandleDialog";
import { AvatarPicker } from "@/components/settings/AvatarPicker";
import { GuestNamePicker } from "@/components/settings/GuestNamePicker";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { startOAuth, unlinkIdentity, AuthRequestError, type OAuthProvider } from "@/api/auth";
import { getAccessToken, useAuthStore } from "@/stores/useAuthStore";
import { getPlatformType } from "@/platform";
import { openExternal } from "@/lib/openExternal";

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  discord: "Discord",
  email: "Email",
};

function providerIcon(provider: string) {
  if (provider === "github") return <Github className="h-4 w-4 shrink-0" />;
  if (provider === "discord") return <DiscordIcon className="h-4 w-4 shrink-0" />;
  return <Mail className="h-4 w-4 shrink-0" />;
}

export function AccountSection() {
  const account = useAuthStore((s) => s.account);
  const identities = useAuthStore((s) => s.identities);
  const status = useAuthStore((s) => s.status);
  const refresh = useAuthStore((s) => s.refresh);
  const signOut = useAuthStore((s) => s.signOut);
  const showSignIn = useSignInDialog((s) => s.show);
  const [handleOpen, setHandleOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (status !== "signedIn" || !account) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Account</h2>
        <div className="max-w-2xl space-y-6 rounded-lg border bg-card/40 p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <AvatarPicker />
            <div className="min-w-0 flex-1">
              <GuestNamePicker />
            </div>
          </div>
          <div className="h-px bg-border/70" />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              You are not signed in. An account syncs your decks and keeps publications yours on any
              device. Playing does not require one.
            </p>
            <Button className="shrink-0" onClick={() => showSignIn()}>
              Sign in
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const linkedProviders = new Set(identities.map((i) => i.provider));

  async function handleLink(provider: OAuthProvider) {
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    try {
      const desktop = getPlatformType() === "tauri";
      const url = await startOAuth(provider, "link", desktop ? "desktop" : "web", token);
      if (desktop) {
        await openExternal(url);
        const onFocus = () => {
          window.removeEventListener("focus", onFocus);
          void refresh();
        };
        window.addEventListener("focus", onFocus);
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Linking failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink(provider: string) {
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    try {
      await unlinkIdentity(token, provider);
      await refresh();
      toast.success(`${PROVIDER_LABELS[provider] ?? provider} unlinked`);
    } catch (err) {
      if (err instanceof AuthRequestError && err.status === 409) {
        toast.error("You can't unlink your only sign-in method");
      } else {
        toast.error(err instanceof Error ? err.message : "Unlinking failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Account</h2>
      <div className="max-w-2xl space-y-6 rounded-lg border bg-card/40 p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <AvatarPicker />
          <div className="min-w-0 flex-1 space-y-1">
            <Label>Handle</Label>
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-semibold">@{account.handle}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Change handle"
                onClick={() => setHandleOpen(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
            {account.handlePending && (
              <p className="text-xs text-muted-foreground">
                This handle was generated for you — pick your own.
              </p>
            )}
          </div>
        </div>

        <div className="h-px bg-border/70" />

        <div className="space-y-2">
          <Label>Sign-in methods</Label>
          <div className="space-y-1.5">
            {identities.map((identity) => (
              <div
                key={`${identity.provider}-${identity.email ?? ""}`}
                className="flex items-center gap-2 rounded-md border px-3 py-2"
              >
                {providerIcon(identity.provider)}
                <span className="text-sm">
                  {PROVIDER_LABELS[identity.provider] ?? identity.provider}
                </span>
                {identity.email && (
                  <span className="text-xs text-muted-foreground truncate">{identity.email}</span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-7 w-7"
                  title="Unlink"
                  disabled={busy || identities.length <= 1}
                  onClick={() => void handleUnlink(identity.provider)}
                >
                  <Unlink className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            {(["github", "discord"] as const)
              .filter((provider) => !linkedProviders.has(provider))
              .map((provider) => (
                <Button
                  key={provider}
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleLink(provider)}
                >
                  <Link2 className="mr-2 h-3.5 w-3.5" />
                  Link {PROVIDER_LABELS[provider]}
                </Button>
              ))}
          </div>
        </div>

        <div className="h-px bg-border/70" />

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Signed in — your decks and publications sync across devices.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </div>
      <HandleDialog open={handleOpen} onOpenChange={setHandleOpen} />
    </section>
  );
}
