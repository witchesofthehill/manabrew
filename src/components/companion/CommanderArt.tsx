import { cn } from "@/lib/utils";
import { ScryfallImg } from "@/components/ScryfallImg";
import type { CompanionCommanderRef } from "@/stores/useCompanionStore.types";

interface CommanderArtProps {
  refs: [CompanionCommanderRef | null, CompanionCommanderRef | null];
  className?: string;
  variant?: "banner" | "avatar";
}

export function CommanderArt({ refs, className, variant = "banner" }: CommanderArtProps) {
  const primary = refs[0]?.imageUrl;
  const partner = refs[1]?.imageUrl;

  if (!primary && !partner) {
    return <div className={cn("absolute inset-0", className)} aria-hidden />;
  }

  if (variant === "avatar") {
    return (
      <div className={cn("relative overflow-hidden", className)} aria-hidden>
        {primary && (
          <ScryfallImg
            src={primary}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full object-cover object-[center_22%]"
          />
        )}
      </div>
    );
  }

  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)} aria-hidden>
      {primary && (
        <ScryfallImg
          src={primary}
          alt=""
          draggable={false}
          className={cn(
            "absolute inset-0 size-full object-cover object-[center_30%]",
            partner && "w-1/2",
          )}
        />
      )}
      {partner && (
        <ScryfallImg
          src={partner}
          alt=""
          draggable={false}
          className="absolute inset-y-0 right-0 w-1/2 object-cover object-[center_30%]"
        />
      )}
      {/* Darken only the top and bottom bands where the name, status
          chips, counters and commander-damage strip overlap the art —
          the middle (life total) stays untinted so the commander
          illustration reads in its true colours. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black/55 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
    </div>
  );
}
