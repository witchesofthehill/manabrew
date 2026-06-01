import { cn } from "@/lib/utils";
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
          <img
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
        <img
          src={primary}
          alt=""
          draggable={false}
          className={cn(
            "absolute inset-0 size-full object-cover object-[center_30%] opacity-60",
            partner && "w-1/2",
          )}
        />
      )}
      {partner && (
        <img
          src={partner}
          alt=""
          draggable={false}
          className="absolute inset-y-0 right-0 w-1/2 object-cover object-[center_30%] opacity-60"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/40" />
    </div>
  );
}
