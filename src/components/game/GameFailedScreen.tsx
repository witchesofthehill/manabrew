import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
interface GameFailedScreenProps {
  message: string;
  onLeave: () => void;
}
export function GameFailedScreen({ message, onLeave }: GameFailedScreenProps) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center [justify-content:safe_center] gap-4 overflow-y-auto px-6 py-4 text-center [&>*]:shrink-0">
      <AlertTriangle className="h-10 w-10 text-destructive" />
      <p className="text-lg font-semibold">The game failed to start</p>
      <p className="max-w-md text-ui-body text-muted-foreground">
        Something went wrong and the game can&apos;t continue. Please contact the developer.
      </p>
      <p className="max-w-md break-words font-mono text-ui-meta text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onLeave}>
        Leave game
      </Button>
    </div>
  );
}
