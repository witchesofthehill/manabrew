import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getTopBarNav, isNavDestinationActive } from "./navDestinations";

interface TopBarNavProps {
  disabled?: boolean;
}

export function TopBarNav({ disabled = false }: TopBarNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { direct, menus } = getTopBarNav();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  function isActive(to: string) {
    return isNavDestinationActive(to, location.pathname);
  }

  return (
    <nav aria-label="Primary" className="hidden items-center gap-0.5 md:flex">
      {direct.map(({ to, label, icon: Icon }) => (
        <Button
          key={to}
          size="sm"
          variant={isActive(to) ? "secondary" : "ghost"}
          aria-label={label}
          title={label}
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={disabled}
          onClick={() => navigate(to)}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden xl:inline">{label}</span>
        </Button>
      ))}
      {menus.map((menu) => {
        const MenuIcon = menu.icon;
        const menuActive = menu.items.some((item) => !item.external && isActive(item.to));
        return (
          <DropdownMenu
            key={menu.id}
            open={openMenuId === menu.id}
            onOpenChange={(open) => setOpenMenuId(open && !disabled ? menu.id : null)}
          >
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant={menuActive ? "secondary" : "ghost"}
                aria-label={menu.label}
                title={menu.label}
                className="h-8 gap-1 px-2 text-xs"
                disabled={disabled}
              >
                <MenuIcon className="h-4 w-4" />
                {!menu.iconOnly && (
                  <>
                    <span className="hidden xl:inline">{menu.label}</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menu.items.map(({ to, label, icon: ItemIcon, external }) =>
                external ? (
                  <DropdownMenuItem key={to} asChild className="gap-2 text-xs">
                    <a
                      href={to}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        if (disabled) event.preventDefault();
                      }}
                    >
                      <ItemIcon className="h-3.5 w-3.5" />
                      {label}
                    </a>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    key={to}
                    className="gap-2 text-xs"
                    disabled={disabled}
                    onSelect={() => {
                      if (!disabled) navigate(to);
                    }}
                  >
                    <ItemIcon className="h-3.5 w-3.5" />
                    {label}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </nav>
  );
}
