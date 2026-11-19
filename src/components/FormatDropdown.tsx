import type { ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { FormatBadge } from "@/components/game/FormatBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FormatDropdownProps {
  value: string;
  formats: readonly { id: string; name: string }[];
  onValueChange: (formatId: string) => void;
  align?: "start" | "end";
  children?: ReactNode;
}

export function FormatDropdown({
  value,
  formats,
  onValueChange,
  align = "start",
  children,
}: FormatDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm">
            <FormatBadge formatId={value} />
            {formats.find((format) => format.id === value)?.name ?? "Choose format"}
            <ChevronDown />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {formats.map((format) => (
          <DropdownMenuItem
            key={format.id}
            onSelect={() => onValueChange(format.id)}
            className="gap-2"
          >
            <FormatBadge formatId={format.id} />
            <span className="text-ui-label">{format.name}</span>
            {value === format.id && <Check className="ml-auto h-3 w-3 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
