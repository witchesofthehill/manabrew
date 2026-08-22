import { Button } from "@/components/ui/button";
import { AvatarPicker } from "@/components/settings/AvatarPicker";
import { GuestNamePicker } from "@/components/settings/GuestNamePicker";
import { AccountProfileCard } from "@/components/settings/AccountProfileCard";
import { SignInMethodsCard } from "@/components/settings/SignInMethodsCard";
import { AccountActionsCard } from "@/components/settings/AccountActionsCard";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { useAuthStore } from "@/stores/useAuthStore";

export function AccountSection() {
  const account = useAuthStore((s) => s.account);
  const identities = useAuthStore((s) => s.identities);
  const status = useAuthStore((s) => s.status);
  const showSignIn = useSignInDialog((s) => s.show);

  if (status !== "signedIn" || !account) {
    return (
      <section className="mx-auto w-full max-w-2xl space-y-4">
        <section className="rounded-lg border bg-card/40 p-4 sm:p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <AvatarPicker />
            <div className="min-w-0 flex-1">
              <GuestNamePicker />
            </div>
          </div>
          <div className="mt-5 border-t border-border/70 pt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Sync your decks on every device</p>
                <p className="text-sm text-muted-foreground">
                  An account keeps your decks and Community publications yours wherever you play.
                  Playing never requires one.
                </p>
              </div>
              <Button className="shrink-0 self-start sm:self-center" onClick={() => showSignIn()}>
                Sign in
              </Button>
            </div>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-2xl space-y-4">
      <AccountProfileCard account={account} identities={identities} />
      <SignInMethodsCard identities={identities} />
      <AccountActionsCard />
    </section>
  );
}
