import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getTopBarNav, isNavDestinationActive } from "./navDestinations";
import { useAuthStore } from "@/stores/useAuthStore";

interface TopBarNavProps {
  disabled?: boolean;
}

export function TopBarNav({ disabled = false }: TopBarNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const signedIn = useAuthStore((state) => state.status === "signedIn");
  const direct = getTopBarNav(signedIn);

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
    </nav>
  );
}
