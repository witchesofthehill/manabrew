import { Loader2, Play } from "lucide-react";
import { EngineMark } from "@/components/lobby/EngineMark";
import { FormatBadge } from "@/components/game/FormatBadge";
import { ScryfallImg } from "@/components/ScryfallImg";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DeckCard } from "@/protocol/deck";
import type { EngineKind } from "@/protocol";

export type PlayDeckRowSource = "yours" | "starter" | "community";

export interface PlayDeckRow {
  key: string;
  name: string;
  formatId: string;
  source: PlayDeckRowSource;
  engines?: EngineKind[];
  cover?: DeckCard;
  coverUrl?: string;
  lastPlayed?: boolean;
  badge?: string;
  playing?: boolean;
  playDisabled?: boolean;
  onPlay?: () => void;
  onOpen: () => void;
}

const SOURCE_LABEL: Record<PlayDeckRowSource, string> = {
  yours: "Yours",
  starter: "Starter",
  community: "Community",
};

interface PlayDeckTableProps {
  rows: PlayDeckRow[];
}

export function PlayDeckTable({ rows }: PlayDeckTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Deck</TableHead>
          <TableHead className="w-24">Format</TableHead>
          <TableHead className="hidden w-28 sm:table-cell">Source</TableHead>
          <TableHead className="hidden w-20 sm:table-cell">Engine</TableHead>
          <TableHead className="w-28 text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const coverSrc = row.coverUrl ?? row.cover?.uris.art_crop;
          return (
            <TableRow
              key={row.key}
              className="cursor-pointer"
              onClick={row.onOpen}
              onKeyDown={(event) => {
                if (event.currentTarget !== event.target) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                row.onOpen();
              }}
              role="button"
              tabIndex={0}
              aria-label={`Open ${row.name}`}
            >
              <TableCell className="max-w-0 sm:max-w-none">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-9 w-12 shrink-0 overflow-hidden rounded border border-border/60 bg-muted">
                    {coverSrc && (
                      <ScryfallImg
                        src={coverSrc}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{row.name}</div>
                    <div className="flex items-center gap-1.5">
                      {row.lastPlayed && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                          Last played
                        </span>
                      )}
                      {row.badge && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {row.badge}
                        </span>
                      )}
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground sm:hidden">
                        {SOURCE_LABEL[row.source]}
                      </span>
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <FormatBadge formatId={row.formatId} />
              </TableCell>
              <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                {SOURCE_LABEL[row.source]}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {row.engines?.length ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    {row.engines.map((engine) => (
                      <span key={engine} title={engine}>
                        <EngineMark engine={engine} className="h-3.5 w-3.5" />
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className={cn("flex justify-end gap-1.5")}>
                  {row.onPlay && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={row.playing || row.playDisabled}
                      className="h-7"
                      onClick={(event) => {
                        event.stopPropagation();
                        row.onPlay?.();
                      }}
                    >
                      {row.playing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {row.playing ? "Starting…" : "Play"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={(event) => {
                      event.stopPropagation();
                      row.onOpen();
                    }}
                  >
                    Open
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
