import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export const PREVIEW_SCENARIOS = [
  {
    get label() {
      return i18n._(msg`Portrait / reminder text`);
    },
    name: "Serra Angel",
  },
  {
    get label() {
      return i18n._(msg`Vanilla / flavor text`);
    },
    name: "Savannah Lions",
  },
  {
    get label() {
      return i18n._(msg`Land / mana abilities`);
    },
    name: "Steam Vents",
  },
  {
    get label() {
      return i18n._(msg`Artifact creature`);
    },
    name: "Wurmcoil Engine",
  },
  {
    get label() {
      return i18n._(msg`Planeswalker / loyalty`);
    },
    name: "Jace, the Mind Sculptor",
  },
  {
    get label() {
      return i18n._(msg`Saga / chapters`);
    },
    name: "The Eldest Reborn",
  },
  {
    get label() {
      return i18n._(msg`Class / levels`);
    },
    name: "Ranger Class",
  },
  {
    get label() {
      return i18n._(msg`Transform DFC`);
    },
    name: "Delver of Secrets",
  },
  {
    get label() {
      return i18n._(msg`Transformed DFC`);
    },
    name: "Delver of Secrets",
    back: true,
  },
  {
    get label() {
      return i18n._(msg`Modal DFC`);
    },
    name: "Bala Ged Recovery",
  },
  {
    get label() {
      return i18n._(msg`Modal DFC / land face`);
    },
    name: "Bala Ged Recovery",
    back: true,
  },
  {
    get label() {
      return i18n._(msg`Battle / landscape front`);
    },
    name: "Invasion of Zendikar",
  },
  {
    get label() {
      return i18n._(msg`Battle / creature back`);
    },
    name: "Invasion of Zendikar",
    back: true,
  },
  {
    get label() {
      return i18n._(msg`Split / both halves`);
    },
    name: "Fire // Ice",
  },
  {
    get label() {
      return i18n._(msg`Aftermath / both halves`);
    },
    name: "Cut // Ribbons",
  },
  {
    get label() {
      return i18n._(msg`Room / both doors`);
    },
    name: "Roaring Furnace // Steaming Sauna",
  },
  {
    get label() {
      return i18n._(msg`Plane / landscape`);
    },
    name: "Academy at Tolaria West",
  },
  {
    get label() {
      return i18n._(msg`Phenomenon / landscape`);
    },
    name: "Spatial Merging",
  },
  {
    get label() {
      return i18n._(msg`Scheme / landscape`);
    },
    name: "Your Fate Is Thrice Sealed",
  },
  {
    get label() {
      return i18n._(msg`Adventure / two rules sections`);
    },
    name: "Brazen Borrower",
  },
  {
    get label() {
      return i18n._(msg`Flip card`);
    },
    name: "Budoka Gardener",
  },
  {
    get label() {
      return i18n._(msg`Prototype`);
    },
    name: "Phyrexian Fleshgorger",
  },
  {
    get label() {
      return i18n._(msg`Meld`);
    },
    name: "Bruna, the Fading Light",
  },
  {
    get label() {
      return i18n._(msg`Long rules / scrolling`);
    },
    name: "Questing Beast",
  },
  {
    get label() {
      return i18n._(msg`Face-down / hidden identity`);
    },
    name: "",
  },
] satisfies Array<{
  label: string;
  name: string;
  back?: boolean;
}>;
