import { readonly, ref } from "vue";
import { libraryMessages } from "@/shared/i18n/messages/library";
import { metadataMessages } from "@/shared/i18n/messages/metadata";
import { playbackMessages } from "@/shared/i18n/messages/playback";
import { settingsMessages } from "@/shared/i18n/messages/settings";
import { interfaceMessages } from "@/shared/i18n/messages/interface";
import { inboxMessages } from "@/shared/i18n/messages/inbox";
import { remappingMessages } from "@/shared/i18n/messages/remapping";

export type Locale = "zh-CN" | "en";
const currentLocale = ref<Locale>("zh-CN");
export const locale = readonly(currentLocale);

const englishMessages: Record<string, string> = {
  ...libraryMessages,
  ...metadataMessages,
  ...playbackMessages,
  ...settingsMessages,
  ...interfaceMessages,
  ...inboxMessages,
  ...remappingMessages,
};

export function setLocale(value: Locale) {
  currentLocale.value = value;
  if (typeof document !== "undefined") document.documentElement.lang = value;
}

/** Chinese source messages are the catalog keys, as in gettext. */
export function t(source: string, parameters: Record<string, string | number> = {}): string {
  const message = currentLocale.value === "en" ? (englishMessages[source] ?? source) : source;
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : placeholder,
  );
}
