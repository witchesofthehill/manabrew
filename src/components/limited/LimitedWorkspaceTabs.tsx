import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type LimitedWorkspaceTab = "pack" | "picks" | "preview";

interface LimitedWorkspaceTabsProps {
  value: LimitedWorkspaceTab;
  onChange: (value: LimitedWorkspaceTab) => void;
  packLabel?: string;
}

export function LimitedWorkspaceTabs({
  value,
  onChange,
  packLabel = "Pack",
}: LimitedWorkspaceTabsProps) {
  const tabs: Array<{ value: LimitedWorkspaceTab; label: string }> = [
    { value: "pack", label: packLabel },
    { value: "picks", label: "Picks" },
    { value: "preview", label: "Preview" },
  ];

  return (
    <div className="grid shrink-0 grid-cols-3 rounded-md border border-border/70 bg-card/40 p-1 lg:hidden">
      {tabs.map((tab) => (
        <Button
          key={tab.value}
          size="sm"
          variant="ghost"
          onClick={() => onChange(tab.value)}
          className={cn(
            "h-8 text-xs",
            value === tab.value && "bg-secondary text-secondary-foreground",
          )}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}
