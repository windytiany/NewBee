import { afterEach, describe, expect, test } from "bun:test";
import { computed } from "vue";
import { locale, setLocale, t } from "@/shared/i18n/locale";

afterEach(() => setLocale("zh-CN"));

describe("interface locale", () => {
  test("defaults to Simplified Chinese", () => {
    expect(locale.value).toBe("zh-CN");
    expect(t("通知")).toBe("通知");
  });

  test("updates reactive translations immediately", () => {
    const label = computed(() => t("通知"));
    expect(label.value).toBe("通知");
    setLocale("en");
    expect(locale.value).toBe("en");
    expect(label.value).toBe("Notifications");
    setLocale("zh-CN");
    expect(label.value).toBe("通知");
  });

  test("interpolates named parameters in both languages", () => {
    const parameters = { completed: 2, total: 5 };
    expect(t("已处理 {completed} / {total}", parameters)).toBe("已处理 2 / 5");
    setLocale("en");
    expect(t("已处理 {completed} / {total}", parameters)).toBe("Processed 2 / 5");
  });

  test("preserves unknown messages, missing parameters and literal replacement characters", () => {
    setLocale("en");
    expect(t("unregistered {value}")).toBe("unregistered {value}");
    expect(t("unregistered {value}", { value: "$&" })).toBe("unregistered $&");
    expect(t("{constructor}")).toBe("{constructor}");
  });
});
