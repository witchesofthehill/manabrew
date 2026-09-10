import { cn } from "@/lib/utils";
import { ScryfallImg } from "@/components/ScryfallImg";
import type { DeckCard } from "@/protocol/deck";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";

interface DeckCoverImageProps {
  cover: DeckCard | null | undefined;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
}

export function DeckCoverImage({ cover, alt, className }: DeckCoverImageProps) {
  if (!cover) return null;
  return (
    <ScryfallImg
      src={cover.uris.art_crop}
      alt={alt ?? cover?.identity.name ?? i18n._(msg`Deck cover`)}
      loading="lazy"
      className={cn(
        "absolute inset-0 h-full w-full object-cover",
        "transition-transform duration-300 ease-out group-hover:scale-110",
        className,
      )}
    />
  );
}
