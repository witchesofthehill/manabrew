import { Button } from "@/components/ui/button";
import type { LimitedGuideTopic } from "@/components/limited/limitedSetGuides";

interface LimitedGuideSectionProps {
  title: string;
  topics: LimitedGuideTopic[];
  onInspect: (name: string, anchor: HTMLElement) => Promise<void>;
}

export function LimitedGuideSection({ title, topics, onInspect }: LimitedGuideSectionProps) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {topics.map((topic) => (
          <details key={topic.title} className="rounded border border-border bg-card p-3">
            <summary className="min-h-8 cursor-pointer font-medium">{topic.title}</summary>
            <p className="my-2 leading-relaxed text-muted-foreground">{topic.text}</p>
            <div className="flex flex-wrap gap-1">
              {topic.cards.map((name) => (
                <Button
                  key={name}
                  variant="outline"
                  size="sm"
                  className="h-auto min-h-11 whitespace-normal text-left"
                  aria-label={`Inspect ${name}`}
                  onClick={(event) => {
                    void onInspect(name, event.currentTarget);
                  }}
                >
                  {name}
                </Button>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
