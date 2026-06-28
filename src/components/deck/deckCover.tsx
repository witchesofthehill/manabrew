import { cn } from "@/lib/utils";
import { ScryfallImg } from "@/components/ScryfallImg";
import type { DeckCard } from "@/protocol/deck";

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
      alt={alt ?? cover?.identity.name ?? "Deck cover"}
      loading="lazy"
      className={cn(
        "absolute inset-0 h-full w-full object-cover",
        "transition-transform duration-300 ease-out group-hover:scale-110",
        className,
      )}
    />
  );
}
