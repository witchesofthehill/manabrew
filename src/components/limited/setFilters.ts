import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export const DRAFTABLE_SET_TYPES = new Set([
  "expansion",
  "core",
  "masters",
  "draft_innovation",
  "starter",
]);
export const SET_TYPE_LABELS: Array<{
  key: string;
  label: string;
}> = [
  {
    key: "all",
    get label() {
      return i18n._(msg`All`);
    },
  },
  {
    key: "expansion",
    get label() {
      return i18n._(msg`Expansion`);
    },
  },
  {
    key: "core",
    get label() {
      return i18n._(msg`Core`);
    },
  },
  {
    key: "masters",
    get label() {
      return i18n._(msg`Masters`);
    },
  },
  {
    key: "draft_innovation",
    get label() {
      return i18n._(msg`Draft Innovation`);
    },
  },
  {
    key: "starter",
    get label() {
      return i18n._(msg`Starter`);
    },
  },
];
