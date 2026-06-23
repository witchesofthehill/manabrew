import { forwardRef } from "react";
import { useScryfallImageSrc } from "@/hooks/useScryfallImageSrc";

export const ScryfallImg = forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(
  function ScryfallImg({ src, ...props }, ref) {
    const resolved = useScryfallImageSrc(typeof src === "string" ? src : undefined);
    return <img ref={ref} src={typeof src === "string" ? resolved : src} {...props} />;
  },
);
