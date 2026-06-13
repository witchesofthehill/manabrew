import { ArrowRight } from "lucide-react";
import { DiscordIcon } from "@/components/icons/DiscordIcon";
import { DISCORD_INVITE_URL } from "@/lib/constants";

export function DiscordCallout() {
  return (
    <a
      href={DISCORD_INVITE_URL}
      target="_blank"
      rel="noreferrer"
      className="group relative flex items-center gap-3.5 overflow-hidden rounded-lg border border-primary/30 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent px-4 py-3.5 transition-colors hover:border-primary/60 hover:from-primary/25"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -left-6 top-1/2 size-20 -translate-y-1/2 rounded-full bg-primary/20 blur-2xl transition-opacity opacity-0 group-hover:opacity-100"
      />
      <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
        <DiscordIcon className="size-5" />
      </span>
      <span className="relative flex-1 space-y-0.5">
        <span className="block text-sm font-semibold text-foreground">Join our community</span>
        <span className="block text-xs text-muted-foreground">
          Brewers, drafters, and bug hunters hang out on Discord — pull up a chair.
        </span>
      </span>
      <ArrowRight className="relative size-4 shrink-0 text-primary transition-transform duration-300 group-hover:translate-x-1" />
    </a>
  );
}
