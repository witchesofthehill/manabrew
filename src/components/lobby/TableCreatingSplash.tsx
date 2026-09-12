import { useEffect, useRef, useState } from "react";
import { Cog } from "lucide-react";

const STEP_OUT_MS = 260;

export function TableCreatingSplash({ label }: { label: string }) {
  const [leaving, setLeaving] = useState<string | null>(null);
  const shown = useRef(label);
  useEffect(() => {
    if (shown.current === label) return;
    setLeaving(shown.current);
    shown.current = label;
    const timer = setTimeout(() => setLeaving(null), STEP_OUT_MS);
    return () => clearTimeout(timer);
  }, [label]);

  return (
    <div className="flex h-full min-h-[30rem] items-center justify-center px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex w-[26rem] max-w-full flex-col items-center gap-5 rounded-2xl border border-primary/30 bg-card/85 px-8 py-14 text-center shadow-xl backdrop-blur-md">
        <span className="relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
          <span className="absolute inset-2 rounded-full bg-primary/10" />
          <Cog className="h-7 w-7 animate-[spin_3s_linear_infinite] text-primary" />
        </span>
        <span className="grid min-h-7 w-full font-serif text-lg font-light text-foreground/90 sm:text-xl">
          {leaving && (
            <p key={leaving} className="animate-splash-step-out [grid-area:1/1]">
              {leaving}
            </p>
          )}
          <p key={label} className="animate-splash-step-in [grid-area:1/1]">
            {label}
          </p>
        </span>
      </div>
    </div>
  );
}
