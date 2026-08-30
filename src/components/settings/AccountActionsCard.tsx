import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Download, LogOut, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DeleteAccountDialog } from "@/components/settings/DeleteAccountDialog";
import { exportAccount } from "@/api/auth";
import { getAccessToken, useAuthStore } from "@/stores/useAuthStore";
import { DOCS_URL } from "@/lib/constants";

interface ActionRowProps {
  title: string;
  description: string;
  action: ReactNode;
}

function ActionRow({ title, description, action }: ActionRowProps) {
  return (
    <div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function AccountActionsCard() {
  const signOut = useAuthStore((s) => s.signOut);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    try {
      const data = await exportAccount(token);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `manabrew-${data.account.handle}-${data.exportedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="rounded-lg border bg-card/40 p-4 sm:p-5 space-y-1">
        <Label>Data &amp; session</Label>
        <div className="divide-y divide-border/70">
          <ActionRow
            title="Export my data"
            description="Download your account, decks, and history as JSON."
            action={
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                disabled={busy}
                onClick={() => void handleExport()}
              >
                <Download />
                Export
              </Button>
            }
          />
          <ActionRow
            title="Sign out"
            description="Sign out of Manabrew on this device."
            action={
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                disabled={busy}
                onClick={() => void signOut()}
              >
                <LogOut />
                Sign out
              </Button>
            }
          />
        </div>
        <p className="border-t border-border/70 pt-3 text-xs text-muted-foreground">
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href={`${DOCS_URL}/terms`}
            target="_blank"
            rel="noreferrer"
          >
            Terms
          </a>
          {" · "}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href={`${DOCS_URL}/privacy`}
            target="_blank"
            rel="noreferrer"
          >
            Privacy &amp; data
          </a>
        </p>
      </section>
      <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:p-5 space-y-1">
        <Label className="text-destructive">Danger zone</Label>
        <ActionRow
          title="Delete account"
          description="Erases your account, sign-in methods, decks, and history. Community publications stay up without your name."
          action={
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0 self-start sm:self-center"
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
              Delete account
            </Button>
          }
        />
      </section>
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}
