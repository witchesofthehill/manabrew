import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Swords, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { stopLocalHostedAiRelay } from "@/game/hostedAiPlay";
import {
  beginActiveGameSessionAbandonment,
  clearActiveGameSession,
  endActiveGameSessionAbandonment,
  type ActiveGameSession,
} from "@/lib/activeGameSession";
import { ROUTES } from "@/lib/constants";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface RejoinMatchCardProps {
  session: ActiveGameSession;
  onAbandoned: () => void;
}
const ABANDON_CONNECT_TIMEOUT_MS = 7000;
export function RejoinMatchCard({ session, onAbandoned }: RejoinMatchCardProps) {
  const navigate = useNavigate();
  const currentRoom = useServerStore((state) => state.currentRoom);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [abandonFailed, setAbandonFailed] = useState(false);
  function forgetMatch() {
    clearActiveGameSession();
    endActiveGameSessionAbandonment();
    setConfirmAbandon(false);
    onAbandoned();
    if (session.relayHost) {
      void stopLocalHostedAiRelay().catch((error) => {
        console.warn("Failed to stop the local relay:", error);
      });
    }
  }
  async function abandon() {
    if (abandoning) return;
    setAbandoning(true);
    beginActiveGameSessionAbandonment();
    try {
      let server = useServerStore.getState();
      if (!server.currentRoom && !server.connected && !server.connecting) {
        const prefs = usePreferencesStore.getState();
        await server.connect(
          session.relayHost ?? prefs.serverHost,
          session.relayPort ?? prefs.serverPort,
          session.username || prefs.serverUsername,
          session.relayPassword ?? prefs.serverPassword,
        );
        server = useServerStore.getState();
      }
      if (!server.currentRoom && server.connecting) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            unsubscribe();
            reject(new Error("Connection timed out."));
          }, ABANDON_CONNECT_TIMEOUT_MS);
          const unsubscribe = useServerStore.subscribe((state) => {
            if (!state.connected && state.connecting) return;
            clearTimeout(timeout);
            unsubscribe();
            if (state.connected) resolve();
            else reject(new Error("Connection failed."));
          });
        });
        server = useServerStore.getState();
      }
      if (
        server.currentRoom?.room_id === session.roomId ||
        (!server.currentRoom && server.connected)
      ) {
        await server.leaveRoom(true);
      } else if (!server.connected) {
        throw new Error("Connection failed.");
      }
      forgetMatch();
    } catch {
      endActiveGameSessionAbandonment();
      setAbandoning(false);
      setAbandonFailed(true);
      toast.error(i18n._(msg`Couldn't reach the previous match relay.`));
    }
  }
  return (
    <>
      <section className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4 shadow-xl backdrop-blur-md sm:gap-4 sm:p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
          <Swords className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            <Trans>Match in progress</Trans>
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {currentRoom?.room_id === session.roomId
              ? i18n._(msg`You're still seated at ${currentRoom.room_name}.`)
              : i18n._(msg`You're still seated in an online match.`)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1"
            disabled={abandoning}
            onClick={() => {
              setAbandonFailed(false);
              setConfirmAbandon(true);
            }}
          >
            <Trans>
              <X className="h-3.5 w-3.5" />
              Abandon match
            </Trans>
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={abandoning}
            onClick={() => navigate(ROUTES.LOBBY)}
          >
            <Trans>
              <Swords className="h-3.5 w-3.5" />
              Rejoin
            </Trans>
          </Button>
        </div>
      </section>

      <Dialog
        open={confirmAbandon}
        onOpenChange={(open) => {
          if (!abandoning) setConfirmAbandon(open);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              <Trans>Abandon match?</Trans>
            </DialogTitle>
            <DialogDescription>
              {abandonFailed
                ? i18n._(
                    msg`The relay could not be reached. You can remove this match from this device, but your seat may remain until the relay times it out.`,
                  )
                : i18n._(msg`You will leave your seat and will not be able to rejoin this match.`)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={abandoning}
              onClick={() => setConfirmAbandon(false)}
            >
              <Trans>Keep playing</Trans>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={abandoning}
              onClick={() => {
                if (abandonFailed) forgetMatch();
                else void abandon();
              }}
            >
              {abandoning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {abandoning
                ? i18n._(msg`Abandoning\u2026`)
                : abandonFailed
                  ? i18n._(msg`Remove from this device`)
                  : i18n._(msg`Abandon match`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
