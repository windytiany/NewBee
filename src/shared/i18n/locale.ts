import { readonly, ref } from "vue";
import { libraryMessages } from "@/shared/i18n/libraryMessages";
import { metadataMessages } from "@/shared/i18n/metadataMessages";
import { playbackMessages } from "@/shared/i18n/playbackMessages";
import { settingsMessages } from "@/shared/i18n/settingsMessages";
import { interfaceMessages } from "@/shared/i18n/interfaceMessages";

export type Locale = "zh-CN" | "en";
const currentLocale = ref<Locale>("zh-CN");
export const locale = readonly(currentLocale);

const englishMessages: Record<string, string> = {
  ...libraryMessages,
  ...metadataMessages,
  ...playbackMessages,
  ...settingsMessages,
  ...interfaceMessages,
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
