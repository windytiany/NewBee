import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { setLocale } from "@/shared/i18n/locale";
import { createView, cleanupView } from "../../../support/settings/view";
import { findNode, getTextContent } from "../../../support/host/renderer";

import * as AccentColor from "@/features/settings/appearance/accent";

it("edits appearance controls and translates labels", async () => {
  const { panel, select } = await createView();
  await select("外观");
  const themeSelect = findNode(panel, (node) => node.props.name === "theme-mode");
  expect(themeSelect?.type).toBe("select");
  expect(themeSelect?.children.map((node) => node.props.value)).toEqual([
    "system",
    "light",
    "dark",
  ]);
  const layoutSelect = findNode(panel, (node) => node.props.name === "layout-density");
  expect(layoutSelect?.type).toBe("select");
  expect(layoutSelect?.children.map((node) => node.props.value)).toEqual(["regular", "compact"]);
  for (const color of AccentColor.ACCENT_COLORS) {
    const preset = findNode(panel, (node) => node.props["aria-label"] === `${color.label}色`);
    if (!preset || typeof preset.props.onClick !== "function")
      throw new Error("Missing accent color preset");
    expect(preset.type).toBe("button");
    expect(preset.props.type).toBe("button");
    expect(preset.props["aria-pressed"]).toBe(color.value === AccentColor.DEFAULT_ACCENT_COLOR);
  }
  setLocale("en");
  await Vue.nextTick();
  expect(getTextContent(panel)).toContain("Accent color");
  for (const label of ["Green", "Blue", "Purple", "Pink", "Orange", "Yellow", "Red", "Teal"]) {
    expect(findNode(panel, (node) => node.props["aria-label"] === label)?.type).toBe("button");
  }
  setLocale("zh-CN");
  await Vue.nextTick();
  const bluePreset = findNode(panel, (node) => node.props["aria-label"] === "蓝色");
  if (!bluePreset || typeof bluePreset.props.onClick !== "function")
    throw new Error("Missing blue preset");
  bluePreset.props.onClick();
  await Vue.nextTick();
  expect(bluePreset.props["aria-pressed"]).toBe(true);
  expect(
    findNode(panel, (node) => node.props["aria-label"] === "绿色")?.props["aria-pressed"],
  ).toBe(false);
  const picker = findNode(panel, (node) => node.props.name === "accent-color-picker");
  const textInput = findNode(panel, (node) => node.props.name === "accent-color");
  expect(picker?.type).toBe("input");
  expect(picker?.props.type).toBe("color");
  expect(picker?.props["aria-label"]).toBe("选择自定义主题色");
  expect(textInput?.type).toBe("input");
  expect(textInput?.props.type).toBe("text");
  expect(textInput?.props["aria-label"]).toBe("自定义主题色");
  expect(textInput?.props.pattern).toBe("#[0-9a-fA-F]{6}");
  expect(textInput?.props.maxlength).toBe("7");
  expect(textInput?.props.required).toBe("");
  if (!picker || !textInput) throw new Error("Missing custom accent color inputs");
  expect(Reflect.get(picker, "value")).toBe("#89b4fa");
  expect(Reflect.get(textInput, "value")).toBe("#89b4fa");
  for (const [input, color] of [
    [picker, "#123456"],
    [textInput, "#ABCDEF"],
  ] as const) {
    const update = input.props["onUpdate:modelValue"];
    if (typeof update !== "function") throw new Error("Missing accent color input binding");
    update(color);
    await Vue.nextTick();
    expect(Reflect.get(picker, "value")).toBe(color);
    expect(Reflect.get(textInput, "value")).toBe(color);
    expect(bluePreset.props["aria-pressed"]).toBe(false);
  }
  for (const [id, chinese, english, controls] of [
    ["motion-label", "动态效果", "Motion", ["reduced-motion"]],
    [
      "cover-background-label",
      "封面背景",
      "Cover backgrounds",
      ["album-cover-background", "playing-cover-background"],
    ],
  ] as const) {
    const group = findNode(
      panel,
      (node) => node.props.role === "group" && node.props["aria-labelledby"] === id,
    );
    if (!group) throw new Error(`Missing appearance group ${id}`);
    const heading = findNode(group, (node) => node.type === "h4" && node.props.id === id)!;
    expect(getTextContent(heading)).toBe(chinese);
    for (const name of controls) {
      const checkbox = findNode(group, (node) => node.props.name === name);
      expect(checkbox).not.toBeNull();
      expect(String(checkbox?.parent?.props.class)).not.toContain("bg-");
      expect(String(checkbox?.parent?.props.class)).not.toContain("px-");
    }
    setLocale("en");
    await Vue.nextTick();
    expect(getTextContent(heading)).toBe(english);
    setLocale("zh-CN");
    await Vue.nextTick();
  }
  expect(getTextContent(panel)).toContain("减少动态效果");
  expect(findNode(panel, (node) => node.props.name === "reduced-motion")?.props.type).toBe(
    "checkbox",
  );
  expect(getTextContent(panel)).toContain("专辑详情封面背景");
  expect(getTextContent(panel)).toContain("播放页封面背景");
  expect(
    findNode(panel, (node) => node.props.name === "playing-cover-background")?.props.type,
  ).toBe("checkbox");
  expect(findNode(panel, (node) => node.props.name === "album-cover-background")?.props.type).toBe(
    "checkbox",
  );
});
afterEach(cleanupView);
