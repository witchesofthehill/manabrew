export interface TermsSection {
  heading: string;
  body: string;
}

export interface TermsContent {
  version: string;
  title: string;
  intro: string;
  lastUpdated: string;
  sections: TermsSection[];
}

export const TERMS_AND_CONDITIONS: TermsContent = {
  version: "1.1.0",
  title: "Terms & Conditions",
  lastUpdated: "2026-05-11",
  intro:
    "Welcome to Manabrew. Please read and accept these terms before using the app. Manabrew is free, open-source software licensed under GPL-3.0-or-later; the full licence and third-party notices ship with the source at github.com/fedepoi/bardidinaXmageUI.",
  sections: [
    {
      heading: "1. Acceptance",
      body: "By clicking Accept you confirm that you have read, understood, and agreed to be bound by these terms. If you do not agree, please close the application.",
    },
    {
      heading: "2. What Manabrew is",
      body: "Manabrew is a fan-made, non-commercial desktop and web client for trading card games. It is built on an open-source port of the Forge rules engine (github.com/Card-Forge/forge). The complete source code for Manabrew is published at github.com/fedepoi/bardidinaXmageUI under the GNU General Public License, version 3 or later.",
    },
    {
      heading: "3. Not affiliated with Wizards of the Coast",
      body: "Manabrew is not affiliated with, sponsored by, or endorsed by Wizards of the Coast LLC. Magic: The Gathering, card names, card text, set names, mana symbols, and trade dress are property of Wizards of the Coast. We do not charge for the software and we do not redistribute Wizards' artwork. If you represent a rights holder and have a concern with how the app interoperates with your IP, please contact us via the GitHub repository so we can address it.",
    },
    {
      heading: "4. Card scripts and game data",
      body: "Manabrew ships card scripts, token scripts, and edition metadata derived from upstream Forge. These data files describe rules behaviour and are distributed under GPL-3.0-or-later as part of Forge. See THIRD-PARTY-NOTICES.md in the source repository for the full attribution.",
    },
    {
      heading: "5. Card images and metadata (Scryfall)",
      body: "Card images and oracle text are fetched on demand from Scryfall (scryfall.com) and cached locally for performance. Manabrew does not redistribute Scryfall's image files. Your use of card imagery is subject to Scryfall's terms of service and to Wizards' rights in the underlying artwork.",
    },
    {
      heading: "6. Public alpha — pre-release software",
      body: "Manabrew is in public alpha. Expect bugs, missing features, incomplete rules coverage, and breaking changes. Saved decks, settings, and game data may be lost or invalidated between versions. Do not rely on the app for tournament-quality rulings. The maintainers may pause or discontinue the service at any time.",
    },
    {
      heading: "7. Local data and privacy",
      body: "Your decks, preferences, and this acknowledgement are stored locally on your device — in your browser's local storage on the web build, and in the operating system's application data directory on desktop. Manabrew does not send telemetry or analytics to the maintainers. Multiplayer games are relayed through a WebSocket lobby server operated by the maintainers; that server processes the connection metadata (including your IP address) and the game messages needed to relay them between players. The players you choose to play against will see the game state and metadata you share with them.",
    },
    {
      heading: "8. Your rights under GPL-3.0-or-later",
      body: "Because Manabrew is GPL-3.0-or-later, you are free to run, study, modify, and redistribute the software under the terms of that licence. The complete corresponding source code is available at the GitHub repository linked above. The full licence text is included as LICENSE-GPL-3.0-or-later in that repository.",
    },
    {
      heading: "9. No warranty, no liability",
      body: "The software is provided 'as is', without warranty of any kind, in line with sections 15 and 16 of the GNU GPL v3. To the maximum extent permitted by law, the maintainers are not liable for any direct, indirect, incidental, or consequential damages arising from your use of the software, including loss of data. Nothing in these terms limits any non-waivable consumer-protection rights you have in your country of residence.",
    },
    {
      heading: "10. Acceptable use",
      body: "Do not use Manabrew to harass other players, to distribute malware via shared decks or game state, or to circumvent the rights of third parties (including Wizards of the Coast or Scryfall). Do not sell or rebrand the software in a way that suggests it is an official Wizards of the Coast product.",
    },
    {
      heading: "11. Governing law and contact",
      body: "These terms are governed by the laws of England and Wales, without prejudice to mandatory consumer-protection rights in your country of residence. For copyright, takedown, privacy, or other legal queries, please open an issue or email the maintainers via the GitHub repository at github.com/fedepoi/bardidinaXmageUI.",
    },
    {
      heading: "12. Changes",
      body: "We may revise these terms. Material changes are signalled by a new version number; when that happens, you will be asked to acknowledge the new terms on next launch. Non-material edits (typos, formatting) do not trigger re-acknowledgement.",
    },
  ],
};
