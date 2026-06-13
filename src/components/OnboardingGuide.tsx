import { Github, Layers, Swords } from "lucide-react";
import { GITHUB_REPO_URL } from "@/lib/constants";

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
    heading: "Host your own ManaBrew rooms",
    icon: Github,
    body: "Want to run a private server for your playgroup?",
    link: {
      label: "Find out how on GitHub",
      href: GITHUB_REPO_URL,
    },
  },
];

export function OnboardingGuide() {
  return (
    <div className="space-y-3">
      {GUIDE_SECTIONS.map((section) => (
        <section
          key={section.heading}
          className="flex items-start gap-3.5 rounded-lg border border-border/60 bg-card/50 px-4 py-3.5 backdrop-blur-sm"
        >
          <section.icon className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-foreground">{section.heading}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {section.body}
              {section.link ? (
                <>
                  {" "}
                  <a
                    href={section.link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {section.link.label}
                  </a>
                  .
                </>
              ) : null}
            </p>
          </div>
        </section>
      ))}
    </div>
  );
}
