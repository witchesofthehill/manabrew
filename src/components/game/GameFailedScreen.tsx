import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Trans } from "@lingui/react/macro";
interface GameFailedScreenProps {
  message: string;
  onLeave: () => void;
}
export function GameFailedScreen({ message, onLeave }: GameFailedScreenProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" />
      <p className="text-lg font-semibold">
        <Trans>The game failed to start</Trans>
      </p>
      <p className="max-w-md text-muted-foreground">
        <Trans>
          Something went wrong and the game can&apos;t continue. Please contact the developer.
        </Trans>
      </p>
      <p className="max-w-md break-words font-mono text-xs text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onLeave}>
        <Trans>Leave game</Trans>
      </Button>
    </div>
  );
}
