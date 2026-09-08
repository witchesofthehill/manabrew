import { useMemo } from "react";
import type { StackObjectDto } from "@/protocol/game";
import type { ChooseBoardTargetsInput } from "@/protocol";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { stackObjectAbilityText, stackObjectToCardStub } from "../game.utils";
import { Modal } from "./Modal";
import { DialogCardBrowser } from "./DialogCardBrowser";

export interface StackDialogContext {
  mode: "browse" | "target";
  prompt?: ChooseBoardTargetsInput;
  pending?: boolean;
  onCancelTarget?: () => void;
  resolveName?: (id: string) => string;
}
interface SpellStackModalProps extends StackDialogContext {
  stack: StackObjectDto[];
  validSpellIds: string[];
  onTarget: (spellId: string) => void;
  onCancel: () => void;
  playerColorMap?: Map<string, string>;
}
export function SpellStackModal({
  stack,
  validSpellIds,
  onTarget,
  onCancel,
  playerColorMap,
  mode,
  prompt,
  pending,
  onCancelTarget,
  resolveName = (id) => id,
}: SpellStackModalProps) {
  const theme = useTheme().gameTheme;
  const legal = useMemo(() => new Set(validSpellIds), [validSpellIds]);
  const entries = useMemo(() => [...stack].reverse(), [stack]);
  const byId = useMemo(() => new Map(stack.map((entry) => [entry.id, entry])), [stack]);
  const items = useMemo(
    () =>
      entries.map((entry, index) => ({
        id: entry.id,
        card: stackObjectToCardStub(entry),
        description: entry.text,
        position: index === 0 ? "Top · resolves next" : `Resolution ${index + 1}`,
        legal: mode === "target" && legal.has(entry.id),
      })),
    [entries, mode, legal],
  );
  const targetCount = items.filter((item) => item.legal).length;
  return (
    <Modal onClose={onCancel} maxWidth="max-w-[1280px]" className="h-[90dvh]">
      <Modal.Header onClose={onCancel}>
        <h2 className="text-base font-semibold">
          {mode === "target"
            ? prompt?.presentation.title || "Choose a stack target"
            : "Spell stack"}
        </h2>
        <p className="text-xs text-muted-foreground">
          {stack.length} entries · Top resolves first
          {mode === "target" ? ` · ${targetCount} legal targets` : ""}
        </p>
      </Modal.Header>
      {mode === "target" && (
        <Modal.Instructions>
          {prompt?.presentation.description || "Inspect any entry, then choose a legal target."}
          {prompt && ` ${prompt.chosenTargets} / ${prompt.maxTargets} targets chosen.`}
          {targetCount === 0 && " No legal stack targets are currently available."}
        </Modal.Instructions>
      )}
      {stack.length ? (
        <DialogCardBrowser
          items={items}
          modeLabel={mode === "target" ? "Choose targets" : "Browse stack"}
          pending={pending}
          intentColor={prompt?.hostile ? theme.arrow.hostileTarget : theme.arrow.friendlyTarget}
          onActivate={
            mode === "target"
              ? (item) => {
                  if (!pending && legal.has(item.id)) onTarget(item.id);
                }
              : undefined
          }
          actionLabel={() => "Choose this stack target"}
          highlight={(item) => stackObjectAbilityText(byId.get(item.id)!)}
          details={(item) => {
            const entry = byId.get(item.id)!;
            return (
              <div className="space-y-2 text-xs">
                <p className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: playerColorMap?.get(entry.controllerId) ?? theme.cardRing,
                    }}
                  />
                  {resolveName(entry.controllerId)}
                  {entry.isCasting ? " · Casting" : ""}
                </p>
                <DynamicTextRender text={entry.text} />
                {entry.targets.length > 0 && (
                  <div>
                    <p className="font-semibold">Targets</p>
                    {entry.targets.map((target, index) => (
                      <p key={`${target.kind}:${target.id}:${index}`}>{resolveName(target.id)}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          }}
        />
      ) : (
        <Modal.Body>
          <Modal.EmptyState message="The stack is empty. New entries will appear here while this browser stays open." />
        </Modal.Body>
      )}
      <Modal.Footer>
        {mode === "target" && prompt?.cancellable && onCancelTarget && (
          <Button variant="outline" disabled={pending} onClick={onCancelTarget}>
            Cancel targeting
          </Button>
        )}
        <Modal.Close onClose={onCancel} variant="outline">
          Close browser
        </Modal.Close>
      </Modal.Footer>
    </Modal>
  );
}
