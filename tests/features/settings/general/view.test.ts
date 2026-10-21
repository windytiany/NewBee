import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { setLocale } from "@/shared/i18n/locale";
import { createView, cleanupView } from "../../../support/settings/view";
import { findNode, getTextContent } from "../../../support/host/renderer";

it("edits general options and translates the shell", async () => {
  const { header, footer, panel, navigation, categoryButtons } = await createView();
  const generalButton = categoryButtons[0]!;
  if (typeof generalButton.props.onClick !== "function") throw new Error("Missing general handler");
  generalButton.props.onClick();
  await Vue.nextTick();
  const lightweightOption = findNode(panel, (node) => node.props.name === "lightweight-on-close");
  expect(lightweightOption?.props.disabled).toBe(false);
  const closeOptions = ["exit", "tray", "exit", "tray"] as const;
  for (const value of closeOptions) {
    const radio = findNode(
      panel,
      (node) => node.props.name === "close-behavior" && node.props.value === value,
    );
    const change = radio?.props["native-change"];
    if (!radio || typeof change !== "function") throw new Error("Missing close behavior event");
    Reflect.set(radio, "checked", true);
    change({ target: radio });
    await Vue.nextTick();
    expect(lightweightOption?.props.disabled).toBe(value !== "tray");
    for (const option of closeOptions) {
      const input = findNode(
        panel,
        (node) => node.props.name === "close-behavior" && node.props.value === option,
      );
      expect(Reflect.get(input!, "checked")).toBe(option === value);
    }
  }
  const languageSelect = findNode(panel, (node) => node.props.name === "locale");
  expect(languageSelect?.type).toBe("select");
  expect(languageSelect?.children.map((node) => getTextContent(node))).toEqual([
    "简体中文",
    "English",
  ]);
  setLocale("en");
  await Vue.nextTick();
  expect(getTextContent(header).trim()).toBe("Settings");
  expect(getTextContent(footer)).toContain("Cancel");
  expect(getTextContent(footer)).toContain("Save");
  expect(getTextContent(navigation)).toContain("General");
  expect(getTextContent(navigation)).toContain("Appearance");
  expect(getTextContent(panel)).toContain("Language");
  setLocale("zh-CN");
  await Vue.nextTick();
});

afterEach(cleanupView);
