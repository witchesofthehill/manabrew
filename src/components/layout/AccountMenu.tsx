import { CircleUserRound, LogIn, Settings } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isFeatureEnabled } from "@/featureFlags";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { stripUsernameTag } from "@/lib/username";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { getMoreDestinations } from "./navDestinations";

interface AccountMenuProps {
  disabled?: boolean;
}

const MENU_ITEM_CLASS = "gap-2.5 rounded-md px-2.5 py-2 text-[13px] pointer-coarse:py-2.5";

export function AccountMenu({ disabled = false }: AccountMenuProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const account = useAuthStore((s) => s.account);
  const status = useAuthStore((s) => s.status);
  const showSignIn = useSignInDialog((s) => s.show);
  const customAvatar = useAuthStore((s) => s.account?.avatarUrl);
  const serverUsername = usePreferencesStore((s) => s.serverUsername);
  const signedInAccount = status === "signedIn" ? account : null;
  const accountsEnabled = isFeatureEnabled("accounts");

  const displayName = signedInAccount
    ? `@${signedInAccount.handle}`
    : stripUsernameTag(serverUsername);
  const initial = (signedInAccount ? signedInAccount.handle : stripUsernameTag(serverUsername))
    .charAt(0)
    .toUpperCase();
  const isSettingsRoute =
    location.pathname === ROUTES.SETTINGS || location.pathname.startsWith(`${ROUTES.SETTINGS}/`);

  function renderAvatar(sizeClass: string, initialClass: string) {
    if (customAvatar) {
      return <img src={customAvatar} alt="" className={cn("size-full object-cover", sizeClass)} />;
    }
    if (initial) {
      return (
        <span
          aria-hidden
          className={cn(
            "flex size-full items-center justify-center bg-primary/15 font-semibold text-primary",
            sizeClass,
            initialClass,
          )}
        >
          {initial}
        </span>
      );
    }
    return <CircleUserRound className="h-4 w-4 text-muted-foreground" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={signedInAccount ? `Account: @${signedInAccount.handle}` : "Account menu"}
          title={signedInAccount ? `@${signedInAccount.handle}` : displayName || "Account"}
          className={cn(
            "relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-muted",
            "motion-safe:transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "data-[state=open]:border-primary/50 data-[state=open]:ring-2 data-[state=open]:ring-ring",
            isSettingsRoute && "border-primary/50",
          )}
        >
          {renderAvatar("h-8 w-8", "text-sm")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-64 rounded-xl p-2"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center gap-3 px-2 pb-2.5 pt-1.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-muted">
            {renderAvatar("h-11 w-11", "text-base")}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{displayName || "Guest"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {signedInAccount ? "Signed in" : "Playing as a guest"}
            </p>
          </div>
        </div>
        <DropdownMenuSeparator />
        {accountsEnabled && signedInAccount && (
          <DropdownMenuItem
            className={MENU_ITEM_CLASS}
            disabled={disabled}
            onSelect={() => navigate(ROUTES.SETTINGS, { state: { settingsTab: "account" } })}
          >
            <CircleUserRound />
            Account
          </DropdownMenuItem>
        )}
        {accountsEnabled && !signedInAccount && (
          <DropdownMenuItem
            className={MENU_ITEM_CLASS}
            disabled={disabled}
            onSelect={() => showSignIn()}
          >
            <LogIn />
            Sign in
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className={MENU_ITEM_CLASS}
          disabled={disabled}
          onSelect={() => navigate(ROUTES.SETTINGS)}
        >
          <Settings />
          Preferences
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {getMoreDestinations().map(({ to, label, icon: ItemIcon, external }) =>
          external ? (
            <DropdownMenuItem key={to} asChild className={MENU_ITEM_CLASS}>
              <a
                href={to}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  if (disabled) event.preventDefault();
                }}
              >
                <ItemIcon />
                {label}
              </a>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={to}
              className={MENU_ITEM_CLASS}
              disabled={disabled}
              onSelect={() => navigate(to)}
            >
              <ItemIcon />
              {label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
