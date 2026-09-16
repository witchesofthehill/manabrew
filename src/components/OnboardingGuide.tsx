import { Github, Layers, Swords } from "lucide-react";
import { GITHUB_REPO_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

const GUIDE_SECTIONS = [
  {
    heading: "Play with friends",
    icon: Swords,
    body: "Connect to a server from the Lobby, then join a room — or create your own — to battle other players in real time.",
  },
  {
    heading: "Customize your deck",
    icon: Layers,
    body: "Open the Deck Editor to build decks from scratch, import existing lists, and fine-tune every card before you sit down at the table.",
  },
  {
    heading: "Host your own Manabrew rooms",
    icon: Github,
    body: "Want to run a private server for your playgroup?",
    link: {
      label: "Find out how on GitHub",
      href: GITHUB_REPO_URL,
    },
  },
];

export function OnboardingGuide({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {GUIDE_SECTIONS.map((section) => (
        <section
          key={section.heading}
          className={cn(
            "flex items-start gap-3.5 rounded-lg border border-border/60 bg-card/50 px-4 py-3.5 backdrop-blur-sm",
            compact && "gap-3 px-3 py-2",
          )}
        >
          <section.icon className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-foreground">{section.heading}</h3>
            <p
              className={cn(
                "text-sm leading-relaxed text-muted-foreground",
                compact && "leading-snug",
              )}
            >
              {section.body}
            </p>
            {section.link ? (
              <a
                href={section.link.href}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
              >
                {section.link.label}
              </a>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}
