import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CompanionIcon } from "./icons";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface CustomCounterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableIcons: string[];
  onConfirm: (input: { label: string; iconKey: string; value: number }) => void;
}
export function CustomCounterDialog({
  open,
  onOpenChange,
  availableIcons,
  onConfirm,
}: CustomCounterDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Custom counter</Trans>
          </DialogTitle>
        </DialogHeader>
        {open && (
          <CustomCounterForm
            availableIcons={availableIcons}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function CustomCounterForm({
  availableIcons,
  onCancel,
  onConfirm,
}: {
  availableIcons: string[];
  onCancel: () => void;
  onConfirm: CustomCounterDialogProps["onConfirm"];
}) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState(0);
  const [iconKey, setIconKey] = useState<string>(availableIcons[0] ?? "Star");
  return (
    <>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="companion-counter-label">
            <Trans>Label</Trans>
          </Label>
          <Input
            id="companion-counter-label"
            value={label}
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
            placeholder={i18n._(msg`e.g. Quest, Lore, Shield\u2026`)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="companion-counter-value">
            <Trans>Starting value</Trans>
          </Label>
          <Input
            id="companion-counter-value"
            type="number"
            value={value}
            onChange={(e) => setValue(Number.parseInt(e.target.value, 10) || 0)}
          />
        </div>
        <div className="space-y-1">
          <Label>
            <Trans>Icon</Trans>
          </Label>
          <div className="grid grid-cols-8 gap-1">
            {availableIcons.map((key) => (
              <button
                type="button"
                key={key}
                onClick={() => setIconKey(key)}
                className={cn(
                  "grid size-9 place-items-center rounded-md border",
                  key === iconKey
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-accent",
                )}
                aria-label={key}
              >
                <CompanionIcon iconKey={key} className="size-4" />
              </button>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          disabled={!label.trim()}
          onClick={() => onConfirm({ label: label.trim(), iconKey, value })}
        >
          <Trans>Add counter</Trans>
        </Button>
      </DialogFooter>
    </>
  );
}
