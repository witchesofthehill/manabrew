import { ChevronDown } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getTopBarNav } from "./navDestinations";

export function TopBarNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { direct, menus } = getTopBarNav();

  function isActive(to: string) {
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  return (
    <nav aria-label="Primary" className="hidden items-center gap-0.5 md:flex">
      {direct.map(({ to, label, icon: Icon }) => (
        <Button
          key={to}
          size="sm"
          variant={isActive(to) ? "secondary" : "ghost"}
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => navigate(to)}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden lg:inline">{label}</span>
        </Button>
      ))}
      {menus.map((menu) => {
        const MenuIcon = menu.icon;
        const menuActive = menu.items.some((item) => !item.external && isActive(item.to));
        return (
          <DropdownMenu key={menu.id}>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant={menuActive ? "secondary" : "ghost"}
                className="h-8 gap-1 px-2 text-xs"
              >
                <MenuIcon className="h-4 w-4" />
                <span className="hidden lg:inline">{menu.label}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menu.items.map(({ to, label, icon: ItemIcon, external }) =>
                external ? (
                  <DropdownMenuItem key={to} asChild className="gap-2 text-xs">
                    <a href={to} target="_blank" rel="noreferrer">
                      <ItemIcon className="h-3.5 w-3.5" />
                      {label}
                    </a>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    key={to}
                    className="gap-2 text-xs"
                    onSelect={() => navigate(to)}
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
