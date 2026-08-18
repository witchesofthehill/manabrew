import { BookOpen, Globe, ScrollText, ShieldCheck } from "lucide-react";
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
          description="News, downloads, and everything Manabrew at manabrew.app."
        />
        <LinkCallout
          href={DOCS_URL}
          icon={<BookOpen className="size-5" />}
          title="Read the docs"
          description="Guides, formats, and self-hosting at docs.manabrew.app."
        />
        <LinkCallout
          href={`${DOCS_URL}/terms`}
          icon={<ScrollText className="size-5" />}
          title="Terms"
          description="What Manabrew is, what it isn't, and the licence it ships under."
        />
        <LinkCallout
          href={`${DOCS_URL}/privacy`}
          icon={<ShieldCheck className="size-5" />}
          title="Privacy & data"
          description="What we store, what we never collect, and how to export or delete it."
        />
      </div>
    </div>
  );
}
