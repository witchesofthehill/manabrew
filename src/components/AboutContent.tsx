import { BookOpen, Globe } from "lucide-react";
import { OnboardingGuide } from "@/components/OnboardingGuide";
import { DiscordCallout } from "@/components/DiscordCallout";
import { LinkCallout } from "@/components/LinkCallout";
import { DOCS_URL, WEBSITE_URL } from "@/lib/constants";

export function AboutContent() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <OnboardingGuide />
      <div className="space-y-3">
        <DiscordCallout />
        <LinkCallout
          href={WEBSITE_URL}
          icon={<Globe className="size-5" />}
          title="Visit the website"
          description="News, downloads, and everything ManaBrew at manabrew.app."
        />
        <LinkCallout
          href={DOCS_URL}
          icon={<BookOpen className="size-5" />}
          title="Read the docs"
          description="Guides, formats, and self-hosting at docs.manabrew.app."
        />
      </div>
    </div>
  );
}
