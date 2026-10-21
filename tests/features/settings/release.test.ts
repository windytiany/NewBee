import { cleanupEditor } from "../../support/settings/editor";
import type { Settings } from "@/features/settings/types";
import { afterEach, describe, expect, it } from "bun:test";
import { createEditor, defaults, deferred } from "../../support/settings/editor";

import { DEFAULT_SHORTCUTS } from "@/features/shortcuts/bindings";

describe("settings release", () => {
  it("requires confirmation before discarding settings for lightweight mode", async () => {
    let confirmations = 0;
    let discard = false;
    const dialog = createEditor(async () => defaults, undefined, {
      confirm: async () => {
        confirmations++;
        return discard;
      },
    });
    await dialog.bindings.show();
    dialog.bindings.draft.lightweightOnClose = true;
    expect(await dialog.prepareRelease()).toBe(false);
    expect(dialog.element.open).toBe(true);
    discard = true;
    expect(await dialog.prepareRelease()).toBe(true);
    expect(dialog.element.open).toBe(false);
    expect(confirmations).toBe(2);
    expect(dialog.suspensions[dialog.suspensions.length - 1]).toBe(false);
  });

  it("closes an unchanged settings dialog without a discard warning", async () => {
    let confirmations = 0;
    const dialog = createEditor(async () => defaults, undefined, {
      confirm: async () => {
        confirmations++;
        return true;
      },
    });
    await dialog.bindings.show();
    expect(await dialog.prepareRelease()).toBe(true);
    expect(confirmations).toBe(0);
    expect(dialog.element.open).toBe(false);
  });

  it("keeps the settings draft when the window reopens during confirmation", async () => {
    const confirmation = deferred<boolean>();
    const dialog = createEditor(async () => defaults, undefined, {
      confirm: () => confirmation.promise,
    });
    await dialog.bindings.show();
    dialog.bindings.draft.lightweightOnClose = true;
    const controller = new AbortController();
    const preparing = dialog.prepareRelease(controller.signal);
    await Promise.resolve();
    controller.abort();
    confirmation.resolve(true);
    expect(await preparing).toBe(false);
    expect(dialog.element.open).toBe(true);
  });

  it("blocks settings saving and closing while backup is pending", async () => {
    const calls: string[] = [];
    const { bindings, element } = createEditor(async (command) => {
      calls.push(command);
      return defaults;
    });
    await bindings.show();
    bindings.selectedCategory.value = "advanced";
    bindings.isBackingUp.value = true;
    bindings.close();
    await bindings.save();
    expect(element.open).toBe(true);
    expect(calls).toEqual(["get_settings"]);
    bindings.isBackingUp.value = false;
    bindings.close();
    expect(element.open).toBe(false);
  });

  it("suspends before loading, restores on close and does not share shortcut references", async () => {
    const { bindings, suspensions } = createEditor(async () => {
      expect(suspensions[suspensions.length - 1]).toBe(true);
      return defaults;
    });
    await bindings.show();
    expect(suspensions).toEqual([true]);
    bindings.draft.shortcuts.previous.shortcut = "Ctrl+KeyP";
    expect(defaults.shortcuts.previous.shortcut).toBe("Ctrl+Shift+ArrowLeft");
    expect(DEFAULT_SHORTCUTS.previous.shortcut).toBe("Ctrl+Shift+ArrowLeft");
    bindings.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(suspensions).toEqual([true, false]);
    await bindings.show();
    expect(bindings.draft.shortcuts).toEqual(defaults.shortcuts);
  });

  it("blocks loading when suspension fails and restores shortcuts", async () => {
    let loads = 0;
    const { bindings, suspensions, feedback } = createEditor(
      async () => {
        loads++;
        return defaults;
      },
      async (suspended) => {
        if (suspended) throw new Error("Unavailable");
      },
    );
    await bindings.show();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loads).toBe(0);
    expect(bindings.isLoaded.value).toBe(false);
    expect(suspensions).toEqual([true, false]);
    expect(feedback[feedback.length - 1]?.key).toBe("settings-load");
  });

  it("restores after load failure but keeps suspension after save failure", async () => {
    let failLoad = true;
    const { bindings, element, suspensions } = createEditor(async (command) => {
      if (command === "get_settings" && !failLoad) return defaults;
      throw new Error("Unavailable");
    });
    await bindings.show();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(suspensions).toEqual([true, false]);
    bindings.close();
    failLoad = false;
    await bindings.show();
    await bindings.save();
    expect(suspensions[suspensions.length - 1]).toBe(true);
    expect(element.open).toBe(true);
  });
});

afterEach(cleanupEditor);

it("reports load, save, backup and diagnostic activity to the release lifecycle", async () => {
  const load = deferred<Settings>();
  const saving = deferred<void>();
  const logging = deferred<void>();
  const editor = createEditor(async (command) => {
    if (command === "get_settings") return load.promise;
    if (command === "save_settings") return saving.promise;
    if (command === "set_detailed_logging") return logging.promise;
  });
  const showing = editor.bindings.show();
  expect(editor.isActive()).toBe(true);
  load.resolve(defaults);
  await showing;
  expect(editor.isActive()).toBe(false);
  editor.bindings.isBackingUp.value = true;
  expect(editor.isActive()).toBe(true);
  editor.bindings.isBackingUp.value = false;
  const changing = editor.bindings.diagnostics.changeLogging();
  expect(editor.isActive()).toBe(true);
  logging.resolve();
  await changing;
  expect(editor.isActive()).toBe(false);
  const pending = editor.bindings.save();
  expect(editor.isActive()).toBe(true);
  saving.resolve();
  await pending;
  expect(editor.isActive()).toBe(false);
});

it("waits for diagnostic work before releasing and restoring shortcuts", async () => {
  const idle = deferred<void>();
  const logging = deferred<void>();
  const editor = createEditor(
    async (command) => (command === "get_settings" ? defaults : logging.promise),
    undefined,
    { idle: () => idle.promise },
  );
  await editor.bindings.show();
  const changing = editor.bindings.diagnostics.changeLogging();
  const release = editor.prepareRelease();
  await Promise.resolve();
  expect(editor.element.open).toBe(true);
  expect(editor.suspensions).toEqual([true]);
  logging.resolve();
  await changing;
  idle.resolve();
  expect(await release).toBe(true);
  expect(editor.element.open).toBe(false);
  expect(editor.suspensions).toEqual([true, false]);
});

it("invalidates a pending load and removes the release guard on unmount", async () => {
  const loaded = deferred<Settings>();
  const editor = createEditor(() => loaded.promise);
  const showing = editor.bindings.show();
  await new Promise((resolve) => setTimeout(resolve, 0));
  editor.unmount();
  expect(editor.isGuardRemoved()).toBe(true);
  loaded.resolve({ ...defaults, closeBehavior: "exit" });
  await showing;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(editor.bindings.draft.closeBehavior).toBe("tray");
  expect(editor.bindings.isLoaded.value).toBe(false);
  expect(editor.suspensions).toEqual([true, false]);
  expect(editor.feedback).toEqual([]);
});
