import { forwardRef } from "react";
import { useScryfallImageSrc } from "@/hooks/useScryfallImageSrc";
import { shouldUseAnonymousImage } from "@/lib/scryfallImageSource";

export const ScryfallImg = forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(
  function ScryfallImg({ src, crossOrigin, ...props }, ref) {
    const resolved = useScryfallImageSrc(typeof src === "string" ? src : undefined);
    return (
      <img
        ref={ref}
        crossOrigin={crossOrigin ?? (shouldUseAnonymousImage(resolved) ? "anonymous" : undefined)}
        src={typeof src === "string" ? resolved : src}
        {...props}
      />
    );
  },
);
