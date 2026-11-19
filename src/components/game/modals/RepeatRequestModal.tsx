import { useId, useRef, useState } from "react";
import { Info, Minus, Plus } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { REPEAT_LIMIT, REPEAT_QUICK_PICKS } from "../game.constants";
interface RepeatRequestModalProps {
  actions: string[];
  multiplayer: boolean;
  onConfirm: (iterations: number) => Promise<void>;
  onClose: () => void;
}
export function RepeatRequestModal({
  actions,
  multiplayer,
  onConfirm,
  onClose,
}: RepeatRequestModalProps) {
  const id = useId();
  const [iterations, setIterations] = useState(10);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const submitting = useRef(false);
  const clamp = (value: number) => Math.max(1, Math.min(REPEAT_LIMIT, Math.round(value) || 1));
  const quickPicks = [...REPEAT_QUICK_PICKS, REPEAT_LIMIT];
  const confirm = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm(iterations);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  return (
    <Modal maxWidth="max-w-md" onClose={pending ? undefined : onClose}>
      <Modal.Header>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Repeat recorded actions (experimental)</h2>
          <Tooltip open={infoOpen} onOpenChange={setInfoOpen}>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="How does this work?"
                onClick={() => setInfoOpen(true)}
              >
                <Info className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="max-w-72 space-y-2 p-3">
              <p>
                The game makes the recorded choices again, in the same order. This works only for
                truly identical loops: every iteration must show the same prompts and offer the same
                cards.
              </p>
              <p>
                A loop that grows with each iteration does not work. For example, if each iteration
                creates a new trigger, the next iteration has one more step than the recording.
              </p>
              <p>
                When an iteration does not match, the repeat stops and the game goes back to the
                state before the repeat. This also undoes the iterations that completed.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </Modal.Header>
      <Modal.Body className="space-y-4 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          {actions.map((action, index) => (
            <li key={index}>
              <DynamicTextRender className="align-middle" text={action} />
            </li>
          ))}
        </ol>
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-4">
            <Button
              variant="outline"
              size="icon"
              aria-label="Fewer times"
              disabled={pending || iterations <= 1}
              onClick={() => setIterations(clamp(iterations - 1))}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <div className="min-w-24 text-center" aria-live="polite">
              <div className="text-4xl font-semibold tabular-nums">{iterations}</div>
              <div className="text-xs text-muted-foreground">
                {iterations === 1 ? `time` : `times`}
              </div>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="More times"
              disabled={pending || iterations >= REPEAT_LIMIT}
              onClick={() => setIterations(clamp(iterations + 1))}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <input
            id={`${id}-iterations`}
            type="range"
            aria-label="Times to repeat"
            min={1}
            max={REPEAT_LIMIT}
            value={iterations}
            disabled={pending}
            onChange={(e) => setIterations(clamp(Number(e.target.value)))}
            className="w-full accent-primary"
          />
          <div className="flex justify-center gap-2">
            {quickPicks.map((n) => (
              <Button
                key={n}
                size="sm"
                variant={n === iterations ? "selected" : "outline"}
                disabled={pending}
                onClick={() => setIterations(n)}
              >
                {n === REPEAT_LIMIT ? `Max ${n}` : n}
              </Button>
            ))}
          </div>
        </div>
        {multiplayer && (
          <p className="text-muted-foreground">Every other player must accept the repeat.</p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-destructive p-3 text-destructive">
            The repeat could not be sent: {error}
          </p>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-between">
        <Modal.Close data-autofocus variant="ghost" disabled={pending} onClose={onClose}>
          Cancel
        </Modal.Close>
        <Button variant="primary" disabled={pending} onClick={() => void confirm()}>
          {`Repeat ${iterations} ${iterations === 1 ? "time" : "times"}`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
