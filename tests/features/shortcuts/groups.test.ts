import { afterEach, expect, it } from "bun:test";
import { SHORTCUT_ACTIONS } from "@/features/shortcuts/bindings";
import { BINDING_GROUPS, SHORTCUT_GROUPS } from "@/features/shortcuts/groups";
import { setLocale, t } from "@/shared/i18n/locale";

afterEach(() => setLocale("zh-CN"));

it("groups every configurable action exactly once for settings and overview", () => {
  const actions = BINDING_GROUPS.flatMap((group) => group.actions);
  expect([...actions].sort()).toEqual([...SHORTCUT_ACTIONS].sort());
  expect(new Set(actions).size).toBe(actions.length);
  expect(new Set(SHORTCUT_GROUPS.map((group) => group.id)).size).toBe(SHORTCUT_GROUPS.length);
  expect(BINDING_GROUPS.map((group) => group.label)).toEqual([
    "播放控制",
    "音量",
    "页面导航",
    "队列",
    "窗口",
    "应用操作",
  ]);
  expect(SHORTCUT_GROUPS.filter((group) => group.keys?.length).map((group) => group.label)).toEqual(
    ["焦点导航", "列表操作", "菜单与弹窗"],
  );
});

it("translates every group and fixed interaction label", () => {
  setLocale("en");
  for (const group of SHORTCUT_GROUPS) {
    expect(t(group.label)).not.toMatch(/\p{Script=Han}/u);
    for (const [, label] of group.keys ?? []) expect(t(label)).not.toMatch(/\p{Script=Han}/u);
  }
});
