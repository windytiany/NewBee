import { describe, expect, test } from "bun:test";
import { libraryMessages } from "@/shared/i18n/messages/library";
import { metadataMessages } from "@/shared/i18n/messages/metadata";
import { playbackMessages } from "@/shared/i18n/messages/playback";
import { settingsMessages } from "@/shared/i18n/messages/settings";
import { interfaceMessages } from "@/shared/i18n/messages/interface";
import { inboxMessages } from "@/shared/i18n/messages/inbox";

const catalogs = {
  libraryMessages,
  metadataMessages,
  playbackMessages,
  settingsMessages,
  notificationMessages: interfaceMessages,
  inboxMessages,
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
