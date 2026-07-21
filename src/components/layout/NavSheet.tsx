import { useState } from "react";
import { Menu, Swords } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { getTopBarNav, type NavDestination } from "./navDestinations";

interface NavSheetProps {
  disabled?: boolean;
}

export function NavSheet({ disabled = false }: NavSheetProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { direct, menus } = getTopBarNav();

  function isActive(to: string) {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  function go(to: string) {
    if (disabled) return;
    setOpen(false);
    navigate(to);
  }

  function renderRow({ to, label, icon: Icon, external }: NavDestination) {
    const className = cn(
      "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors",
      !external && isActive(to)
        ? "bg-secondary font-medium text-secondary-foreground"
        : "text-foreground/85 hover:bg-muted/60",
    );
    if (external) {
      return (
        <a
          key={to}
          href={to}
          target="_blank"
          rel="noreferrer"
          className={className}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </a>
      );
    }
    return (
      <button
        key={to}
        type="button"
        disabled={disabled}
        onClick={() => go(to)}
        className={className}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </button>
    );
  }

  return (
    <Sheet open={!disabled && open} onOpenChange={setOpen}>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 md:hidden"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="Menu"
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Menu</span>
      </Button>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-3 pb-6">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <div className="pt-2">
          {renderRow({ to: ROUTES.PLAY, label: "Play", icon: Swords })}
          {direct.map(renderRow)}
          {menus.map((menu) => (
            <div key={menu.id} className="pt-3">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {menu.label}
              </p>
              {menu.items.map(renderRow)}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
