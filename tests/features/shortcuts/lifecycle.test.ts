import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { evaluateSource, transpileScript } from "../../support/module/loader";
import { createHostNode, createHostRenderer } from "../../support/host/renderer";
import { DEFAULT_SHORTCUTS } from "@/features/shortcuts/bindings";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";

const output = transpileScript(
  await Bun.file(
    new URL("../../../src/features/shortcuts/useShortcuts.ts", import.meta.url),
  ).text(),
);
const originals = new Map(
  ["window", "document", "Element"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
const apps: Array<{ unmount: () => void }> = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

class ShortcutTarget {
  constructor(
    private readonly editing = false,
    private readonly selectors: readonly string[] = [],
  ) {}
  closest(selector: string) {
    return (this.editing && selector.startsWith("input,")) || this.selectors.includes(selector)
      ? this
      : null;
  }
}

async function flush() {
  await Vue.nextTick();
  await Promise.resolve();
  await Promise.resolve();
}

async function mountShortcuts(desktop = true, registrationError: string | null = null) {
  const listeners = new Map<string, (event: unknown) => void>();
  const registrations: Array<{ type: string; capture?: boolean }> = [];
  const removals: Array<{ type: string; capture?: boolean }> = [];
  const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const feedback: string[] = [];
  const pages: string[] = [];
  let unlistenCount = 0;
  let errorListener: ((event: { payload: string }) => void) | null = null;
  const settings = {
    shortcuts: {
      ...DEFAULT_SHORTCUTS,
      togglePlayback: { shortcut: "Ctrl+KeyP", global: false },
      toggleWindow: { shortcut: "Ctrl+KeyW", global: false },
    },
  };
  let dialogOpen = false;
  let reads = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener(type: string, listener: (event: unknown) => void, capture?: boolean) {
        registrations.push({ type, capture });
        listeners.set(type, listener);
      },
      removeEventListener(type: string, listener: (event: unknown) => void, capture?: boolean) {
        removals.push({ type, capture });
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      querySelector: () => (dialogOpen ? {} : null),
    },
  });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: ShortcutTarget });
  const hook = evaluateSource<typeof import("@/features/shortcuts/useShortcuts")>(output, {
    vue: Vue,
    "@tauri-apps/api/core": {
      isTauri: () => desktop,
      invoke: async (command: string, args?: Record<string, unknown>) => {
        invocations.push({ command, args });
        return command === "get_shortcuts_error" ? registrationError : null;
      },
    },
    "@tauri-apps/api/event": {
      listen: async (_name: string, listener: (event: { payload: string }) => void) => {
        errorListener = listener;
        return () => {
          unlistenCount++;
        };
      },
    },
    "@/shared/notifications/center": {
      notify: (notification: { message: string }) => feedback.push(notification.message),
    },
    "@/shared/logging/logger": { logger: { error() {}, warn() {} } },
    "@/features/settings/api": {
      createSettingsApi: () => ({
        get: async () => {
          reads++;
          return settings;
        },
      }),
    },
  });
  const app = createHostRenderer(createHostNode).createApp({
    setup() {
      hook.useShortcuts((page) => pages.push(page));
      return () => null;
    },
  });
  app.mount(createHostNode("root"));
  apps.push(app);
  await flush();
  function keydown(
    code = "KeyP",
    editing = false,
    options: {
      target?: ShortcutTarget;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      repeat?: boolean;
    } = {},
  ) {
    let prevented = false;
    let stopped = false;
    listeners.get("keydown")?.({
      code,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      isComposing: false,
      defaultPrevented: false,
      repeat: false,
      target: new ShortcutTarget(editing),
      ...options,
      preventDefault: () => {
        prevented = true;
      },
      stopImmediatePropagation: () => {
        stopped = true;
      },
    });
    return { prevented, stopped };
  }
  return {
    app,
    settings,
    feedback,
    pages,
    get unlistenCount() {
      return unlistenCount;
    },
    emitError(reason: string) {
      errorListener?.({ payload: reason });
    },
    registrations,
    removals,
    invocations,
    listeners,
    keydown,
    get reads() {
      return reads;
    },
    setDialogOpen(value: boolean) {
      dialogOpen = value;
    },
  };
}

describe("application shortcut lifecycle", () => {
  it("runs application shortcuts before list handlers, but not while editing or in a dialog", async () => {
    const harness = await mountShortcuts();
    expect(harness.registrations).toContainEqual({ type: "keydown", capture: true });
    expect(harness.keydown()).toEqual({ prevented: true, stopped: true });
    await flush();
    expect(harness.invocations.filter((call) => call.command === "run_shortcut")).toEqual([
      { command: "run_shortcut", args: { action: "togglePlayback" } },
    ]);
    expect(harness.keydown("KeyW", true)).toEqual({ prevented: false, stopped: false });
    harness.setDialogOpen(true);
    expect(harness.keydown("KeyW")).toEqual({ prevented: false, stopped: false });
    await flush();
    expect(harness.invocations.filter((call) => call.command === "run_shortcut")).toHaveLength(1);
  });

  it("preserves native button space and list navigation before application bindings", async () => {
    const harness = await mountShortcuts();
    harness.settings.shortcuts.volumeUp = { shortcut: "Ctrl+ArrowUp", global: false };
    harness.settings.shortcuts.seekForward = { shortcut: "Ctrl+ArrowRight", global: false };
    harness.settings.shortcuts.togglePlayback = { shortcut: "Space", global: false };
    harness.listeners.get(SETTINGS_CHANGED_EVENT)?.(new Event(SETTINGS_CHANGED_EVENT));
    await flush();
    const button = new ShortcutTarget(false, ['button, a, [role="button"]']);
    expect(harness.keydown("Space", false, { target: button, ctrlKey: false }).prevented).toBe(
      false,
    );
    const list = new ShortcutTarget(false, ["[data-keyboard-list]"]);
    expect(harness.keydown("ArrowUp", false, { target: list }).prevented).toBe(false);
    expect(harness.keydown("ArrowRight", false, { target: list }).prevented).toBe(true);
    const grid = new ShortcutTarget(false, ["[data-keyboard-list]", "[data-keyboard-grid]"]);
    expect(harness.keydown("ArrowRight", false, { target: grid }).prevented).toBe(false);
    expect(harness.keydown("ArrowUp").prevented).toBe(true);
    await flush();
    expect(
      harness.invocations
        .filter((call) => call.command === "run_shortcut")
        .map((call) => call.args?.action),
    ).toEqual(["seekForward", "volumeUp"]);
  });

  it("navigates to each page locally without invoking backend actions", async () => {
    const harness = await mountShortcuts();
    for (const [action, page] of [
      ["showPlaying", "Playing"],
      ["showLibrary", "Library"],
      ["showPlaylist", "Playlist"],
      ["showInbox", "Inbox"],
    ] as const) {
      harness.settings.shortcuts[action] = { shortcut: "Ctrl+KeyN", global: false };
      harness.listeners.get(SETTINGS_CHANGED_EVENT)?.(new Event(SETTINGS_CHANGED_EVENT));
      await flush();
      expect(harness.keydown("KeyN", true).prevented).toBe(false);
      harness.setDialogOpen(true);
      expect(harness.keydown("KeyN").prevented).toBe(false);
      harness.setDialogOpen(false);
      expect(harness.keydown("KeyN").prevented).toBe(true);
      await flush();
      expect(harness.pages[harness.pages.length - 1]).toBe(page);
      harness.settings.shortcuts[action] = { shortcut: "", global: false };
    }
    expect(harness.pages).toEqual(["Playing", "Library", "Playlist", "Inbox"]);
    expect(harness.invocations.filter((call) => call.command === "run_shortcut")).toEqual([]);
  });

  it("refreshes mode after saving and removes listeners on unmount", async () => {
    const harness = await mountShortcuts();
    harness.settings.shortcuts.togglePlayback.global = true;
    harness.listeners.get(SETTINGS_CHANGED_EVENT)?.(new Event(SETTINGS_CHANGED_EVENT));
    await flush();
    expect(harness.reads).toBe(2);
    expect(harness.keydown()).toEqual({ prevented: false, stopped: false });
    expect(harness.keydown("KeyW")).toEqual({ prevented: true, stopped: true });
    await flush();
    expect(harness.invocations.filter((call) => call.command === "run_shortcut")).toEqual([
      { command: "run_shortcut", args: { action: "toggleWindow" } },
    ]);
    harness.app.unmount();
    apps.splice(apps.indexOf(harness.app), 1);
    expect(harness.listeners.size).toBe(0);
    expect(harness.removals).toEqual(harness.registrations);
  });

  it("reports startup and later registration errors and stops monitoring on unmount", async () => {
    const harness = await mountShortcuts(true, "Ctrl+KeyP is occupied");
    expect(harness.feedback).toEqual(["快捷键操作失败：Ctrl+KeyP is occupied"]);
    harness.emitError("Window could not be restored");
    expect(harness.feedback[1]).toBe("快捷键操作失败：Window could not be restored");
    harness.app.unmount();
    apps.splice(apps.indexOf(harness.app), 1);
    expect(harness.unlistenCount).toBe(1);
    harness.emitError("stale error");
    expect(harness.feedback).toHaveLength(2);
  });

  it("does not install desktop handlers in browser preview", async () => {
    const harness = await mountShortcuts(false);
    expect(harness.reads).toBe(0);
    expect(harness.registrations).toEqual([]);
    expect(harness.invocations).toEqual([]);
  });
});
