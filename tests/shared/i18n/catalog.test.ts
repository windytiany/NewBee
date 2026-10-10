import { describe, expect, test } from "bun:test";
import { libraryMessages } from "@/shared/i18n/libraryMessages";
import { metadataMessages } from "@/shared/i18n/metadataMessages";
import { playbackMessages } from "@/shared/i18n/playbackMessages";
import { settingsMessages } from "@/shared/i18n/settingsMessages";
import { interfaceMessages } from "@/shared/i18n/interfaceMessages";

const catalogs = {
  libraryMessages,
  metadataMessages,
  playbackMessages,
  settingsMessages,
  notificationMessages: interfaceMessages,
};

function placeholders(message: string) {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe("English message catalogs", () => {
  for (const [name, messages] of Object.entries(catalogs)) {
    test(`${name} contains English translations with matching parameters`, () => {
      expect(Object.keys(messages).length).toBeGreaterThan(0);
      for (const [source, translation] of Object.entries(messages)) {
        expect(translation.trim().length).toBeGreaterThan(0);
        expect(translation).not.toMatch(/\p{Script=Han}/u);
        expect(placeholders(translation)).toEqual(placeholders(source));
      }
    });
  }
});
