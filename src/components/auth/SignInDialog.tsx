import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DiscordIcon } from "@/components/icons/DiscordIcon";
import { isFeatureEnabled } from "@/featureFlags";
import {
  exchangeCode,
  fetchAuthProviders,
  requestMagicLink,
  startOAuth,
  updateHandle,
  verifyEmailCode,
  AuthRequestError,
  type OAuthProvider,
} from "@/api/auth";
import { useAuthStore } from "@/stores/useAuthStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { getPlatformType } from "@/platform";
import { clearAuthReturnIntent, storeAuthReturnIntent } from "@/lib/authReturn";
import { DOCS_URL } from "@/lib/constants";
import type { AuthProviders, AuthSessionResponse } from "@/api/authTypes";
import { openExternal } from "@/lib/openExternal";

type Step = "start" | "email-code" | "desktop-code" | "handle";

export function SignInDialog() {
  const open = useSignInDialog((s) => s.open);
  const prefill = useSignInDialog((s) => s.prefill);
  const hide = useSignInDialog((s) => s.hide);
  const signIn = useAuthStore((s) => s.signIn);
  const setAccount = useAuthStore((s) => s.setAccount);

  const [step, setStep] = useState<Step>("start");
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [handle, setHandle] = useState("");
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providersError, setProvidersError] = useState(false);

  function loadProviders() {
    setProviders(null);
    setProvidersError(false);
    void fetchAuthProviders()
      .then(setProviders)
      .catch(() => setProvidersError(true));
  }

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError(null);
    setCode(prefill?.code ?? "");
    setEmail(prefill?.email ?? "");
    setHandle("");
    setTermsAgreed(false);
    setProvidersError(false);
    if (prefill?.claimHandle) {
      setStep("handle");
    } else if (prefill?.email && prefill?.code) {
      setStep("email-code");
    } else {
      setStep("start");
    }
    setProviders(null);
    void fetchAuthProviders()
      .then(setProviders)
      .catch(() => setProvidersError(true));
  }, [open, prefill]);

  function completeSignIn(session: AuthSessionResponse) {
    clearAuthReturnIntent();
    signIn(session.token, session.account);
    if (session.account.handlePending) {
      setError(null);
      setBusy(false);
      setStep("handle");
      return;
    }
    toast.success(`Signed in as @${session.account.handle}`);
    hide();
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function handleOAuth(provider: OAuthProvider) {
    void run(async () => {
      const desktop = getPlatformType() === "tauri";
      const url = await startOAuth(provider, "signin", desktop ? "desktop" : "web");
      if (desktop) {
        await openExternal(url);
        setStep("desktop-code");
      } else {
        storeAuthReturnIntent(prefill ?? undefined);
        window.location.assign(url);
      }
    });
  }

  function handleSendCode() {
    void run(async () => {
      await requestMagicLink(email.trim());
      storeAuthReturnIntent(prefill ?? undefined);
      setCode("");
      setStep("email-code");
    });
  }

  function handleVerifyEmail() {
    void run(async () => {
      completeSignIn(await verifyEmailCode(email.trim(), code.trim()));
    });
  }

  function handleExchange() {
    void run(async () => {
      completeSignIn(await exchangeCode(code.trim()));
    });
  }

  function handleClaimHandle() {
    void run(async () => {
      const token = useAuthStore.getState().token;
      if (!token) return;
      try {
        const account = await updateHandle(token, handle.trim());
        if (useAuthStore.getState().token !== token) return;
        setAccount(account);
        toast.success(`Signed in as @${account.handle}`);
        hide();
      } catch (err) {
        if (err instanceof AuthRequestError && err.status === 409) {
          throw new Error("That handle is already taken");
        }
        throw err;
      }
    });
  }

  function handleSkipHandle() {
    const account = useAuthStore.getState().account;
    if (account) toast.success(`Signed in as @${account.handle}`);
    hide();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : hide())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "handle" ? "Pick your handle" : "Sign in to Manabrew"}
          </DialogTitle>
          <DialogDescription>
            {step === "handle"
              ? "Your handle is the public name other players see in Community. You can change it later in Preferences."
              : "Your account syncs your decks and keeps publications yours on any device."}
          </DialogDescription>
        </DialogHeader>

        {step === "start" && (
          <div className="space-y-4">
            {providersError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <p>Sign-in methods could not be loaded.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={loadProviders}>
                  Try again
                </Button>
              </div>
            )}
            <div className="space-y-2">
              {!providersError && providers?.github !== false && (
                <Button
                  variant="outline"
                  className="w-full justify-center"
                  disabled={busy || !providers?.github}
                  onClick={() => handleOAuth("github")}
                >
                  <Github className="mr-2 h-4 w-4" />
                  Continue with GitHub
                </Button>
              )}
              {!providersError && providers?.discord !== false && (
                <Button
                  variant="outline"
                  className="w-full justify-center"
                  disabled={busy || !providers?.discord}
                  onClick={() => handleOAuth("discord")}
                >
                  <DiscordIcon className="mr-2 h-4 w-4" />
                  Continue with Discord
                </Button>
              )}
            </div>
            {!providersError && isFeatureEnabled("emailSignIn") && providers?.email !== false && (
              <>
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs uppercase text-muted-foreground">or</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    value={email}
                    placeholder="you@example.com"
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && email.includes("@")) handleSendCode();
                    }}
                  />
                  <Button
                    className="w-full"
                    disabled={busy || !email.includes("@")}
                    onClick={handleSendCode}
                  >
                    {busy ? "Sending…" : "Send sign-in code"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {step === "email-code" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              We sent a code to <span className="font-medium text-foreground">{email}</span>. Enter
              it here, or click the link in the email.
            </p>
            <Label htmlFor="signin-code">Code</Label>
            <Input
              id="signin-code"
              value={code}
              autoFocus
              autoComplete="one-time-code"
              placeholder="ABCD2345"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.trim().length >= 8) handleVerifyEmail();
              }}
            />
            <Button
              className="w-full"
              disabled={busy || code.trim().length < 8}
              onClick={handleVerifyEmail}
            >
              {busy ? "Checking…" : "Continue"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={busy}
              onClick={() => setStep("start")}
            >
              Use another method
            </Button>
          </div>
        )}

        {step === "desktop-code" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Finish signing in with your browser, then enter the code it shows you.
            </p>
            <Label htmlFor="desktop-code">Code</Label>
            <Input
              id="desktop-code"
              value={code}
              autoFocus
              placeholder="ABCD2345"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.trim().length >= 8) handleExchange();
              }}
            />
            <Button
              className="w-full"
              disabled={busy || code.trim().length < 8}
              onClick={handleExchange}
            >
              {busy ? "Checking…" : "Continue"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={busy}
              onClick={() => setStep("start")}
            >
              Use another method
            </Button>
          </div>
        )}

        {step === "handle" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="claim-handle">Handle</Label>
              <Input
                id="claim-handle"
                value={handle}
                autoFocus
                maxLength={24}
                placeholder="your-handle"
                onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && termsAgreed && handle.trim().length >= 3)
                    handleClaimHandle();
                }}
              />
            </div>

            <label className="flex cursor-pointer select-none items-start gap-2.5 text-sm">
              <Checkbox
                checked={termsAgreed}
                onCheckedChange={(value) => setTermsAgreed(value === true)}
                className="mt-0.5"
              />
              <span>
                I agree to the{" "}
                <a
                  href={`${DOCS_URL}/terms`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  terms
                </a>{" "}
                and the{" "}
                <a
                  href={`${DOCS_URL}/privacy`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  privacy policy
                </a>
              </span>
            </label>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={busy || !termsAgreed || handle.trim().length < 3}
                onClick={handleClaimHandle}
              >
                {busy ? "Saving…" : "Claim handle"}
              </Button>
              <Button variant="ghost" disabled={busy || !termsAgreed} onClick={handleSkipHandle}>
                Later
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
