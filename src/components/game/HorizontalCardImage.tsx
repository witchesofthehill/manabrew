import { cn } from "@/lib/utils";
import { ScryfallImg } from "@/components/ScryfallImg";

interface HorizontalCardImageProps {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
}

// Scryfall stores horizontal layouts as upright 5:7 PNGs even though the
// physical card is printed sideways — counter-rotate so the printed
// orientation reads correctly inside the 7:5 wrapper.
export function HorizontalCardImage({ src, alt, className, loading }: HorizontalCardImageProps) {
  return (
    <div className={cn("relative rounded-[inherit]", className)}>
      <ScryfallImg
        src={src}
        alt={alt}
        loading={loading}
        className={cn(
          "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 origin-center",
          "h-[calc(100%*7/5)] aspect-[5/7] rounded-[inherit]",
        )}
      />
    </div>
  );
}
