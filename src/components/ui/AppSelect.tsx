import {
  Children,
  isValidElement,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface AppSelectOptionProps {
  value: string | number;
  children: ReactNode;
  disabled?: boolean;
}

export function AppSelectOption(_props: AppSelectOptionProps) {
  return null;
}

type AppSelectProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onChange"> & {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
};

export function AppSelect({
  value,
  onValueChange,
  children,
  className,
  disabled,
  ...buttonProps
}: AppSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | undefined>();
  const options = Children.toArray(children).filter(
    (child): child is ReactElement<AppSelectOptionProps> =>
      isValidElement(child) && child.type === AppSelectOption,
  );
  const selected = options.find((option) => String(option.props.value) === String(value));

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setPortalContainer(
            triggerRef.current?.closest<HTMLElement>("[data-modal-panel]") ?? undefined,
          );
        }
        setOpen(nextOpen);
      }}
    >
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          ref={triggerRef}
          type="button"
          className={cn(
            "inline-flex h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 pointer-coarse:min-h-11",
            className,
          )}
          disabled={disabled}
          {...buttonProps}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            {selected?.props.children}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        portalContainer={portalContainer}
        className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.key ?? String(option.props.value)}
            disabled={option.props.disabled}
            onSelect={() => onValueChange(String(option.props.value))}
          >
            {option.props.children}
            {String(option.props.value) === String(value) && (
              <Check className="ml-auto h-4 w-4 text-primary" aria-hidden="true" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
