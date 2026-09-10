import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HandleDialog } from "@/components/auth/HandleDialog";
import { AvatarPicker } from "@/components/settings/AvatarPicker";
import type { AuthAccount, AuthIdentity } from "@/api/authTypes";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface AccountProfileCardProps {
  account: AuthAccount;
  identities: AuthIdentity[];
}
export function AccountProfileCard({ account, identities }: AccountProfileCardProps) {
  const [handleOpen, setHandleOpen] = useState(false);
  const email = identities.find((identity) => identity.email)?.email;
  const memberSince = new Date(account.createdAt).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  return (
    <section className="rounded-lg border bg-card/40 p-4 sm:p-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <AvatarPicker />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-1">
            <span className="truncate text-lg font-semibold leading-tight">@{account.handle}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              title={i18n._(msg`Change handle`)}
              onClick={() => setHandleOpen(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            {email && <p className="truncate">{email}</p>}
            <p>
              <Trans>Member since {memberSince}</Trans>
            </p>
          </div>
          {account.handlePending && (
            <p className="text-xs text-warning">
              <Trans>This handle was generated for you — pick your own.</Trans>
            </p>
          )}
        </div>
      </div>
      <HandleDialog open={handleOpen} onOpenChange={setHandleOpen} />
    </section>
  );
}
