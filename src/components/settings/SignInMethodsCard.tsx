import { useState } from "react";
import { toast } from "sonner";
import { Github, Mail, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DiscordIcon } from "@/components/icons/DiscordIcon";
import { startOAuth, unlinkIdentity, AuthRequestError, type OAuthProvider } from "@/api/auth";
import { getAccessToken, useAuthStore } from "@/stores/useAuthStore";
import { getPlatformType } from "@/platform";
import { openExternal } from "@/lib/openExternal";
import type { AuthIdentity } from "@/api/authTypes";

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  discord: "Discord",
  email: "Email",
};

function providerIcon(provider: string) {
  if (provider === "github") return <Github className="h-4 w-4" />;
  if (provider === "discord") return <DiscordIcon className="h-4 w-4" />;
  return <Mail className="h-4 w-4" />;
}

interface SignInMethodsCardProps {
  identities: AuthIdentity[];
}

export function SignInMethodsCard({ identities }: SignInMethodsCardProps) {
  const refresh = useAuthStore((s) => s.refresh);
  const [busy, setBusy] = useState(false);
  const linkedProviders = new Set(identities.map((identity) => identity.provider));
  const linkableProviders = (["github", "discord"] as const).filter(
    (provider) => !linkedProviders.has(provider),
  );

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
    <section className="rounded-lg border bg-card/40 p-4 sm:p-5 space-y-3">
      <Label>Sign-in methods</Label>
      <div className="space-y-2">
        {identities.map((identity) => {
          const label = PROVIDER_LABELS[identity.provider] ?? identity.provider;
          return (
            <div
              key={`${identity.provider}-${identity.email ?? ""}`}
              className="flex items-center gap-3 rounded-lg border bg-background/50 px-3 py-2.5"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                {providerIcon(identity.provider)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight">{label}</p>
                {identity.email && (
                  <p className="truncate text-xs text-muted-foreground">{identity.email}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                title={`Unlink ${label}`}
                disabled={busy || identities.length <= 1}
                onClick={() => void handleUnlink(identity.provider)}
              >
                <Unlink className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>
      {linkableProviders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {linkableProviders.map((provider) => (
            <Button
              key={provider}
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void handleLink(provider)}
            >
              {providerIcon(provider)}
              Link {PROVIDER_LABELS[provider]}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
