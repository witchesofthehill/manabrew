import { useState } from "react";
import { Cog } from "lucide-react";

const ROW_REM = 3.5;

export function TableCreatingSplash({ label }: { label: string }) {
  const [labels, setLabels] = useState([label]);
  if (labels[labels.length - 1] !== label) setLabels([...labels, label]);

  return (
    <div className="flex h-full min-h-[30rem] items-center justify-center px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex w-[26rem] max-w-full flex-col items-center gap-5 rounded-2xl border border-primary/30 bg-card/85 px-8 py-14 text-center shadow-xl backdrop-blur-md">
        <span className="relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
          <span className="absolute inset-2 rounded-full bg-primary/10" />
          <Cog className="h-7 w-7 animate-[spin_3s_linear_infinite] text-primary" />
        </span>
        <span className="block h-14 w-full overflow-hidden [mask-image:linear-gradient(transparent,black_25%,black_75%,transparent)]">
          <span
            className="block transition-transform duration-700 ease-in-out"
            style={{ transform: `translateY(-${(labels.length - 1) * ROW_REM}rem)` }}
          >
            {labels.map((text, index) => (
              <span
                key={index}
                className="flex h-14 items-center justify-center font-serif text-lg font-light text-foreground/90 sm:text-xl"
              >
                {text}
              </span>
            ))}
          </span>
        </span>
      </div>
    </div>
  );
}
