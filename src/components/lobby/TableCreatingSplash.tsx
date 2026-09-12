import { useState } from "react";
import { Cog } from "lucide-react";

export function TableCreatingSplash({ label }: { label: string }) {
  const [current, setCurrent] = useState(label);
  const [leaving, setLeaving] = useState<string | null>(null);
  if (label !== current) {
    setLeaving(current);
    setCurrent(label);
  }

  return (
    <div className="flex h-full min-h-[30rem] items-center justify-center px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex w-[26rem] max-w-full flex-col items-center gap-5 rounded-2xl border border-primary/30 bg-card/85 px-8 py-14 text-center shadow-xl backdrop-blur-md">
        <span className="relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
          <span className="absolute inset-2 rounded-full bg-primary/10" />
          <Cog className="h-7 w-7 animate-[spin_3s_linear_infinite] text-primary" />
        </span>
        <span className="relative block h-14 w-full">
          {leaving && (
            <span
              key={`out-${leaving}`}
              onAnimationEnd={() => setLeaving(null)}
              className="animate-splash-step-out absolute inset-0 flex items-center justify-center font-serif text-lg font-light text-foreground/90 sm:text-xl"
            >
              {leaving}
            </span>
          )}
          <span
            key={`in-${current}`}
            className="animate-splash-step-in absolute inset-0 flex items-center justify-center font-serif text-lg font-light text-foreground/90 sm:text-xl"
          >
            {current}
          </span>
        </span>
      </div>
    </div>
  );
}
