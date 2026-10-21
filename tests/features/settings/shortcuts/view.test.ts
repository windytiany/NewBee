import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";

import { createView, cleanupView } from "../../../support/settings/view";
import { findNode, getTextContent } from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import {
  SHORTCUT_ACTIONS,
  DEFAULT_SHORTCUTS,
  cloneShortcuts,
  formatShortcut,
  allowsGlobalShortcut,
  type ShortcutAction,
} from "@/features/shortcuts/bindings";
import { BINDING_GROUPS } from "@/features/shortcuts/groups";

it("records, restores, clears and persists shortcuts through the dialog", async () => {
  const { root, panel, navigation, saved, suspensions, feedback, events, state, dialog } =
    await createView();
  const shortcutsButton = findNode(
    navigation,
    (node) => node.type === "button" && getTextContent(node).trim() === "快捷键",
  );
  if (!shortcutsButton || typeof shortcutsButton.props.onClick !== "function")
    throw new Error("Missing shortcuts category");
  shortcutsButton.props.onClick();
  await Vue.nextTick();
  expect(findNode(panel, (node) => node.props["aria-label"] === "快捷键设置说明")).toBeNull();
  expect(getTextContent(panel)).not.toContain("缺少日期");
  const initialRecorder = findNode(panel, (node) => node.props.name === "shortcut-previous");
  expect(
    findNode(panel, (node) => node.type === "button" && getTextContent(node).trim() === "清除"),
  ).toBeNull();
  const reset = findNode(
    panel,
    (node) => node.type === "button" && node.props["aria-label"] === "恢复默认",
  );
  if (
    !initialRecorder ||
    typeof initialRecorder.props.onKeydown !== "function" ||
    typeof reset?.props.onClick !== "function"
  )
    throw new Error("Missing shortcut draft controls");
  initialRecorder.props.onKeydown({
    key: "Escape",
    code: "Escape",
    isComposing: false,
    preventDefault() {},
    stopPropagation() {},
  });
  await Vue.nextTick();
  expect(Reflect.get(initialRecorder, "value")).toBe("");
  await reset.props.onClick();
  await Vue.nextTick();
  expect(Reflect.get(initialRecorder, "value")).toBe(
    formatShortcut(DEFAULT_SHORTCUTS.previous.shortcut),
  );
  expect(getTextContent(panel)).not.toContain("确认恢复");
  expect(saved).toEqual([]);
  for (const label of [
    "上一首",
    "下一首",
    "播放/暂停",
    "窗口切换",
    "正在播放",
    "音乐库",
    "播放列表",
    "Inbox",
  ])
    expect(getTextContent(panel)).toContain(label);
  const table = findNode(panel, (node) => node.type === "table");
  if (!table) throw new Error("Missing shortcut table");
  const scroller = table.parent;
  if (!scroller) throw new Error("Missing shortcut table scroller");
  expect(String(scroller.props.class)).toContain("overflow-auto");
  expect(String(scroller.props.class)).toContain("min-h-0");
  expect(String(panel.props.class)).toContain("overflow-hidden");
  expect(String(table.props.class)).toContain("table-fixed");
  expect(findNode(scroller, (node) => node === initialRecorder)).toBe(initialRecorder);
  expect(findNode(panel, (node) => node.props.name === "shortcut-recorder")).toBeNull();
  const shortcutHeading = findNode(panel, (node) => node.type === "h3");
  expect(shortcutHeading).not.toBeNull();
  expect(getTextContent(shortcutHeading!)).toBe("快捷键");
  expect(reset.parent).toBe(shortcutHeading?.parent ?? null);
  expect(getTextContent(reset)).toBe("");
  expect(
    table.children
      .filter((node) => node.type === "tbody")
      .map((node) => node.props["data-shortcut-group"]),
  ).toEqual(BINDING_GROUPS.map((group) => group.id));
  for (const group of BINDING_GROUPS) {
    const body = findNode(table, (node) => node.props["data-shortcut-group"] === group.id);
    if (!body) throw new Error(`Missing shortcut group: ${group.id}`);
    const heading = findNode(body, (node) => node.props.scope === "rowgroup");
    expect(getTextContent(heading!)).toBe(group.label);
    expect(
      body.children
        .filter((node) => node.props["data-shortcut-action"])
        .map((node) => node.props["data-shortcut-action"]),
    ).toEqual([...group.actions]);
  }
  const rows = SHORTCUT_ACTIONS.map((action) => {
    const row = findNode(table, (node) => node.props["data-shortcut-action"] === action);
    if (!row) throw new Error("Missing shortcut action row");
    return row;
  });
  expect(rows).toHaveLength(SHORTCUT_ACTIONS.length);
  for (const row of rows) expect(findNode(row, (node) => node.type === "button")).toBeNull();
  const headings = findNode(table, (node) => node.type === "thead");
  expect(headings?.children[0]?.children.map((node) => getTextContent(node))).toEqual([
    "操作",
    "快捷键",
    "全局",
    "恢复默认",
  ]);
  const recorders: HostNode[] = [];
  const collectRecorders = (node: HostNode) => {
    if (node.props["data-shortcut-recorder"] === "") recorders.push(node);
    node.children.forEach(collectRecorders);
  };
  collectRecorders(panel);
  expect(recorders).toHaveLength(SHORTCUT_ACTIONS.length);
  const selectAction = async (action: ShortcutAction) => {
    const row = rows[SHORTCUT_ACTIONS.indexOf(action)]!;
    const recorder = findNode(row, (node) => node.props["data-shortcut-recorder"] === "");
    if (!recorder || typeof recorder.props.onClick !== "function")
      throw new Error("Missing inline shortcut recorder");
    recorder.props.onClick();
    await Vue.nextTick();
    expect(String(row.props.class)).toContain("bg-app-accent/15");
  };
  for (const action of SHORTCUT_ACTIONS) {
    await selectAction(action);
    const global = findNode(panel, (node) => node.props.name === `shortcuts-global-${action}`);
    expect(Boolean(global)).toBe(allowsGlobalShortcut(action));
    if (global) expect(global.props.type).toBe("checkbox");
    const recorder = findNode(panel, (node) => node.props.name === `shortcut-${action}`);
    if (!recorder || typeof recorder.props.onKeydown !== "function")
      throw new Error("Missing shortcut recorder");
    expect(recorder.props.readonly).toBe("");
    expect(recorder.props["data-shortcut-recorder"]).toBe("");
    expect(recorder.props.placeholder).toBeUndefined();
    expect(Reflect.get(recorder, "value")).toBe(formatShortcut(DEFAULT_SHORTCUTS[action].shortcut));
    let prevented = false;
    let stopped = false;
    const press = (key: string, code: string, ctrlKey = false, isComposing = false) =>
      recorder.props.onKeydown instanceof Function &&
      recorder.props.onKeydown({
        key,
        code,
        ctrlKey,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        isComposing,
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {
          stopped = true;
        },
      });
    press("Control", "ControlLeft", true);
    press("a", "KeyA", true, true);
    await Vue.nextTick();
    expect(Reflect.get(recorder, "value")).toBe(formatShortcut(DEFAULT_SHORTCUTS[action].shortcut));
    press("a", "KeyA", true);
    await Vue.nextTick();
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
    expect(Reflect.get(recorder, "value")).toBe("Ctrl + A");
    const originalInput = Object.getOwnPropertyDescriptor(globalThis, "HTMLInputElement");
    let blurred = false;
    class Input {
      blur() {
        blurred = true;
      }
    }
    Object.defineProperty(globalThis, "HTMLInputElement", { configurable: true, value: Input });
    prevented = false;
    stopped = false;
    try {
      recorder.props.onKeydown({
        key: "Escape",
        code: "Escape",
        isComposing: false,
        target: new Input(),
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        },
      });
    } finally {
      if (originalInput) Object.defineProperty(globalThis, "HTMLInputElement", originalInput);
      else Reflect.deleteProperty(globalThis, "HTMLInputElement");
    }
    await Vue.nextTick();
    expect(blurred).toBe(false);
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
    expect(Reflect.get(recorder, "value")).toBe("");
    expect(
      Reflect.get(
        findNode(root, (node) => node.type === "dialog")!,
        "open",
      ),
    ).toBe(true);
    press("a", "KeyA", true);
    press("Delete", "Delete");
    await Vue.nextTick();
    expect(Reflect.get(recorder, "value")).toBe("");
    press("a", "KeyA", true);
    await Vue.nextTick();
    const row = recorder.parent?.parent;
    if (!row) throw new Error("Missing shortcut row");
    const undo = findNode(row, (node) => node.type === "button");
    expect(undo?.props["aria-label"]).toBe(`恢复默认 ${getTextContent(row.children[0]!)}`);
    expect(getTextContent(undo!)).toBe("");
    press("Escape", "Escape");
    await Vue.nextTick();
    expect(Reflect.get(recorder, "value")).toBe("");
    press("a", "KeyA", true);
    press("Backspace", "Backspace");
    await Vue.nextTick();
    expect(Reflect.get(recorder, "value")).toBe("");
    if (global && typeof global.props["onUpdate:modelValue"] === "function")
      global.props["onUpdate:modelValue"](true);
    if (!undo || typeof undo.props.onClick !== "function") throw new Error("Missing action reset");
    undo.props.onClick();
    await Vue.nextTick();
    expect(Reflect.get(recorder, "value")).toBe(formatShortcut(DEFAULT_SHORTCUTS[action].shortcut));
    if (global) expect(Reflect.get(global, "checked")).toBe(DEFAULT_SHORTCUTS[action].global);
    expect(findNode(row, (node) => node.type === "button")).toBeNull();
    if (global && typeof global.props["onUpdate:modelValue"] === "function") {
      global.props["onUpdate:modelValue"](!DEFAULT_SHORTCUTS[action].global);
      await Vue.nextTick();
      expect(findNode(row, (node) => node.type === "button")).not.toBeNull();
      global.props["onUpdate:modelValue"](DEFAULT_SHORTCUTS[action].global);
      await Vue.nextTick();
      expect(findNode(row, (node) => node.type === "button")).toBeNull();
    }
    expect(saved).toEqual([]);
    press("Backspace", "Backspace");
    await Vue.nextTick();
  }
  await selectAction("previous");
  const previous = findNode(panel, (node) => node.props.name === "shortcut-previous");
  const next = findNode(panel, (node) => node.props.name === "shortcut-next");
  const global = findNode(panel, (node) => node.props.name === "shortcuts-global-previous");
  const form = findNode(root, (node) => node.type === "form");
  if (
    !previous ||
    !next ||
    typeof next.props.onKeydown !== "function" ||
    typeof previous.props.onKeydown !== "function" ||
    !global ||
    typeof global.props["onUpdate:modelValue"] !== "function" ||
    !form ||
    typeof form.props.onSubmit !== "function"
  )
    throw new Error("Missing shortcut controls");
  previous.props.onKeydown({
    key: "p",
    code: "KeyP",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    preventDefault() {},
    stopPropagation() {},
  });
  global.props["onUpdate:modelValue"](true);
  await Vue.nextTick();
  expect(Reflect.get(global, "checked")).toBe(true);
  expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
  await selectAction("next");
  expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
  expect(Reflect.get(global, "checked")).toBe(true);
  next.props.onKeydown({
    key: "n",
    code: "KeyN",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    preventDefault() {},
    stopPropagation() {},
  });
  await Vue.nextTick();
  expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
  expect(Reflect.get(next, "value")).toBe("Ctrl + N");
  await selectAction("previous");
  expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
  expect(Reflect.get(global, "checked")).toBe(true);
  previous.props.onKeydown({
    key: "Escape",
    code: "Escape",
    isComposing: false,
    preventDefault() {},
    stopPropagation() {},
  });
  await Vue.nextTick();
  expect(Reflect.get(previous, "value")).toBe("");
  expect(Reflect.get(global, "checked")).toBe(true);
  expect(Reflect.get(next, "value")).toBe("Ctrl + N");
  previous.props.onKeydown({
    key: "p",
    code: "KeyP",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    preventDefault() {},
    stopPropagation() {},
  });
  expect(state.persisted.shortcuts).toEqual(cloneShortcuts(DEFAULT_SHORTCUTS));
  state.failSave = true;
  await form.props.onSubmit({ preventDefault() {} });
  await Vue.nextTick();
  expect(saved).toEqual([]);
  expect(feedback[feedback.length - 1]?.message).toBe("保存设置失败: Shortcut already registered");
  expect(
    Reflect.get(
      findNode(root, (node) => node.type === "dialog")!,
      "open",
    ),
  ).toBe(true);
  expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
  expect(Reflect.get(global, "checked")).toBe(true);
  await selectAction("next");
  expect(Reflect.get(next, "value")).toBe("Ctrl + N");
  expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
  expect(Reflect.get(global, "checked")).toBe(true);
  state.failSave = false;
  await form.props.onSubmit({ preventDefault() {} });
  expect(saved[0]?.shortcuts).toEqual({
    ...cloneShortcuts({}),
    previous: { shortcut: "Ctrl+KeyP", global: true },
    next: { shortcut: "Ctrl+KeyN", global: false },
  });
  expect(events).toEqual([SETTINGS_CHANGED_EVENT]);
  expect(
    Reflect.get(
      findNode(root, (node) => node.type === "dialog")!,
      "open",
    ),
  ).toBe(false);
  await dialog.show();
  await Vue.nextTick();
  shortcutsButton.props.onClick();
  await Vue.nextTick();
  expect(
    Reflect.get(
      findNode(panel, (node) => node.props.name === "shortcut-previous")!,
      "value",
    ),
  ).toBe("Ctrl + P");
  const reopenedGlobal = findNode(panel, (node) => node.props.name === "shortcuts-global-previous");
  expect(reopenedGlobal && Reflect.get(reopenedGlobal, "checked")).toBe(true);
  const reopenedNext = findNode(panel, (node) => node.props["data-shortcut-action"] === "next");
  const reopenedNextButton =
    reopenedNext && findNode(reopenedNext, (node) => node.props.name === "shortcut-next");
  if (!reopenedNextButton || typeof reopenedNextButton.props.onClick !== "function")
    throw new Error("Missing reopened next action");
  reopenedNextButton.props.onClick();
  await Vue.nextTick();
  expect(
    Reflect.get(
      findNode(panel, (node) => node.props.name === "shortcut-next")!,
      "value",
    ),
  ).toBe("Ctrl + N");
  expect(reopenedGlobal && Reflect.get(reopenedGlobal, "checked")).toBe(true);
  const nativeDialog = findNode(root, (node) => node.type === "dialog");
  if (
    !nativeDialog ||
    typeof nativeDialog.props.onCancel !== "function" ||
    typeof nativeDialog.props.onClose !== "function"
  )
    throw new Error("Missing close handlers");
  nativeDialog.props.onCancel({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(suspensions[suspensions.length - 1]).toBe(false);
  await dialog.show();
  nativeDialog.props.onClose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(suspensions[suspensions.length - 1]).toBe(true);
  Reflect.set(nativeDialog, "open", false);
  nativeDialog.props.onClose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(suspensions[suspensions.length - 1]).toBe(false);
});

afterEach(cleanupView);

it("keeps shortcut selection across categories and resets it on a new editing session", async () => {
  const { panel, select, dialog, root } = await createView();
  await select("快捷键");
  const recorder = findNode(panel, (node) => node.props.name === "shortcut-next")!;
  if (typeof recorder.props.onClick !== "function") throw new Error("Missing recorder");
  recorder.props.onClick();
  await Vue.nextTick();
  await select("常规");
  await select("快捷键");
  const next = findNode(panel, (node) => node.props["data-shortcut-action"] === "next")!;
  expect(String(next.props.class)).toContain("bg-app-accent/15");
  const nativeDialog = findNode(root, (node) => node.type === "dialog")!;
  if (typeof nativeDialog.props.onCancel !== "function") throw new Error("Missing cancel handler");
  nativeDialog.props.onCancel({ preventDefault() {} });
  await dialog.show();
  await Vue.nextTick();
  await select("快捷键");
  const previous = findNode(panel, (node) => node.props["data-shortcut-action"] === "previous")!;
  expect(String(previous.props.class)).toContain("bg-app-accent/15");
  expect(
    String(findNode(panel, (node) => node.props["data-shortcut-action"] === "next")!.props.class),
  ).not.toContain("bg-app-accent/15");
});
