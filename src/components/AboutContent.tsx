import { BookOpen, Globe, ScrollText, ShieldCheck } from "lucide-react";
import { OnboardingGuide } from "@/components/OnboardingGuide";
import { DiscordCallout } from "@/components/DiscordCallout";
import { LinkCallout } from "@/components/LinkCallout";
import { DOCS_URL, WEBSITE_URL } from "@/lib/constants";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export function AboutContent() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <OnboardingGuide />
      <div className="space-y-3">
        <DiscordCallout />
        <LinkCallout
          href={WEBSITE_URL}
          icon={<Globe className="size-5" />}
          title={i18n._(msg`Visit the website`)}
          description={i18n._(msg`News, downloads, and everything Manabrew at manabrew.app.`)}
        />
        <LinkCallout
          href={DOCS_URL}
          icon={<BookOpen className="size-5" />}
          title={i18n._(msg`Read the docs`)}
          description={i18n._(msg`Guides, formats, and self-hosting at docs.manabrew.app.`)}
        />
        <LinkCallout
          href={`${DOCS_URL}/terms`}
          icon={<ScrollText className="size-5" />}
          title={i18n._(msg`Terms`)}
          description={i18n._(
            msg`What Manabrew is, what it isn't, and the licence it ships under.`,
          )}
        />
        <LinkCallout
          href={`${DOCS_URL}/privacy`}
          icon={<ShieldCheck className="size-5" />}
          title={i18n._(msg`Privacy & data`)}
          description={i18n._(
            msg`What we store, what we never collect, and how to export or delete it.`,
          )}
        />
      </div>
    </div>
  );
}
