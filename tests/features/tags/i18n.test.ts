import { afterEach, expect, it } from "bun:test";
import { parse } from "@vue/compiler-sfc";
import { metadataMessages } from "@/shared/i18n/messages/metadata";
import { setLocale } from "@/shared/i18n/locale";
import { TAG_FIELDS, buildTagChanges } from "@/features/tags/draft";
import type { DraftField } from "@/features/tags/types";

const placeholders = (message: string) =>
  [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
afterEach(() => setLocale("zh-CN"));

it("covers every lyrics and tags translation source with matching English placeholders", async () => {
  const sources = new Set<string>([...TAG_FIELDS.map(({ label }) => label), "歌词"]);
  for (const feature of ["lyrics", "tags"]) {
    for await (const path of new Bun.Glob("**/*.{ts,vue}").scan(`src/features/${feature}`)) {
      const source = await Bun.file(`src/features/${feature}/${path}`).text();
      for (const match of source.matchAll(/\bt\(\s*(['"])(.*?)\1/g)) {
        const key = match[2];
        if (key) sources.add(key);
      }
      if (path.endsWith(".vue")) {
        const { descriptor } = parse(source);
        const visible = descriptor.template?.content
          .replace(/\{\{[\s\S]*?\}\}/g, "")
          .replace(/(?:v-[\w:-]+|:[\w-]+|@[\w.-]+)="[^"]*"/g, "");
        expect(visible ?? "", path).not.toMatch(/\p{Script=Han}/u);
      }
    }
  }
  for (const source of sources) {
    const english = metadataMessages[source];
    expect(english, source).toBeDefined();
    expect(english, source).not.toMatch(/\p{Script=Han}/u);
    expect(placeholders(english ?? ""), source).toEqual(placeholders(source));
  }
});

it("evaluates validation messages and field labels in the current locale without changing draft data", () => {
  const field: DraftField = {
    key: "trackNumber",
    label: "曲号",
    type: "number",
    value: "0",
    originalValue: "1",
    mixed: false,
    writable: true,
  };
  expect(() => buildTagChanges([field])).toThrow("曲号必须是有效的正整数或留空。");
  setLocale("en");
  expect(() => buildTagChanges([field])).toThrow(
    "Track number must be a valid positive integer or empty.",
  );
  expect(field.label).toBe("曲号");
  expect(field.value).toBe("0");
  setLocale("zh-CN");
  expect(() => buildTagChanges([field])).toThrow("曲号必须是有效的正整数或留空。");
});
