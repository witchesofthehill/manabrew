import { Users } from "lucide-react";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DraftSeat } from "@/types/limited";
import { Trans } from "@lingui/react/macro";
interface DraftPodButtonProps {
  seats: DraftSeat[];
}
export function DraftPodButton({ seats }: DraftPodButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-xs">
          <Trans>
            <Users className="h-3.5 w-3.5" />
            Pod ({seats.length})
          </Trans>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
          <Trans>Pod</Trans>
        </DropdownMenuLabel>
        <ul className="space-y-1 px-2 pb-2 text-sm">
          {seats.map((s) => (
            <li
              key={s.seat}
              className="flex items-center justify-between gap-3 rounded px-1 py-0.5"
            >
              <span className={s.isHuman ? "font-semibold" : ""}>
                {s.seat}. {s.name}
              </span>
              <span className="shrink-0 text-right text-[11px] text-muted-foreground">
                <span className="block">
                  <Trans>{s.currentPackSize ?? 0} cards</Trans>
                  {(s.packsWaiting ?? 0) > 0 ? i18n._(msg` · ${s.packsWaiting ?? 0} waiting`) : ""}
                </span>
                <span className="block">
                  {s.awaitingPick ? i18n._(msg`Picking`) : i18n._(msg`${s.picksMade} picked`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
