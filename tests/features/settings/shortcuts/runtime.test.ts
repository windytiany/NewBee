import { describe, expect, it, mock } from "bun:test";
import { createShortcutRuntime } from "@/features/settings/shortcuts/runtime";
import { DEFAULT_SHORTCUTS, cloneShortcuts } from "@/features/settings/shortcuts/bindings";
import type { ShortcutAction } from "@/features/settings/shortcuts/bindings";
import type { ShortcutSettings } from "@/features/settings/types";

type ShortcutEvent = Parameters<ReturnType<typeof createShortcutRuntime>["handleKeydown"]>[0];
type SettingsResult = { shortcuts: ShortcutSettings };

const bindings: ShortcutSettings = {
  ...DEFAULT_SHORTCUTS,
  previous: { shortcut: "Ctrl+ArrowLeft", global: false },
  next: { shortcut: "Ctrl+ArrowRight", global: false },
  togglePlayback: { shortcut: "Space", global: false },
  toggleWindow: { shortcut: "Super+KeyW", global: false },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function keyEvent(overrides: Partial<ShortcutEvent> = {}) {
  return {
    code: "Space",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    defaultPrevented: false,
    repeat: false,
    preventDefault: mock(() => {}),
    stopImmediatePropagation: mock(() => {}),
    ...overrides,
  };
}

function createRuntime(
  getSettings = async (): Promise<SettingsResult> => ({ shortcuts: bindings }),
) {
  const run = mock<(action: ShortcutAction) => Promise<void>>(async () => {});
  const onError = mock<(reason: unknown) => void>(() => {});
  const runtime = createShortcutRuntime({ getSettings, run, onError });
  return { runtime, run, onError };
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("shortcut runtime", () => {
  it("does not dispatch until asynchronous settings loading completes", async () => {
    const settings = deferred<SettingsResult>();
    const { runtime, run } = createRuntime(() => settings.promise);
    const refresh = runtime.refresh();
    const before = keyEvent();
    runtime.handleKeydown(before);
    await settle();
    expect(run).not.toHaveBeenCalled();
    expect(before.preventDefault).not.toHaveBeenCalled();
    settings.resolve({ shortcuts: bindings });
    await refresh;
    const after = keyEvent();
    runtime.handleKeydown(after);
    await settle();
    expect(run).toHaveBeenCalledWith("togglePlayback");
    expect(after.preventDefault).toHaveBeenCalledTimes(1);
    expect(after.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch default empty bindings or unmatched keys", async () => {
    const { runtime, run } = createRuntime(async () => ({ shortcuts: DEFAULT_SHORTCUTS }));
    await runtime.refresh();
    const event = keyEvent();
    runtime.handleKeydown(event);
    await settle();
    expect(run).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("dispatches all four configured actions", async () => {
    const { runtime, run } = createRuntime();
    await runtime.refresh();
    runtime.handleKeydown(keyEvent({ code: "ArrowLeft", ctrlKey: true }));
    runtime.handleKeydown(keyEvent({ code: "ArrowRight", ctrlKey: true }));
    runtime.handleKeydown(keyEvent());
    runtime.handleKeydown(keyEvent({ code: "KeyW", metaKey: true }));
    await settle();
    expect(run.mock.calls.map(([action]) => action)).toEqual([
      "previous",
      "next",
      "togglePlayback",
      "toggleWindow",
    ]);
  });

  it("ignores global actions locally while dispatching other local actions", async () => {
    const { runtime, run } = createRuntime(async () => ({
      shortcuts: { ...bindings, togglePlayback: { ...bindings.togglePlayback, global: true } },
    }));
    await runtime.refresh();
    const event = keyEvent();
    runtime.handleKeydown(event);
    await settle();
    expect(run).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    const localEvent = keyEvent({ code: "ArrowRight", ctrlKey: true });
    runtime.handleKeydown(localEvent);
    await settle();
    expect(run).toHaveBeenCalledWith("next");
    expect(localEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(localEvent.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it("respects the blocked flag supplied for editing or an open dialog", async () => {
    const { runtime, run } = createRuntime();
    await runtime.refresh();
    const blocked = keyEvent();
    runtime.handleKeydown(blocked, true);
    await settle();
    expect(run).not.toHaveBeenCalled();
    expect(blocked.preventDefault).not.toHaveBeenCalled();
    expect(blocked.stopImmediatePropagation).not.toHaveBeenCalled();
    runtime.handleKeydown(keyEvent(), false);
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  for (const overrides of [
    { defaultPrevented: true },
    { isComposing: true },
    { code: "ControlLeft" },
    { code: "KeyQ" },
  ]) {
    it(`ignores events with ${JSON.stringify(overrides)}`, async () => {
      const { runtime, run } = createRuntime();
      await runtime.refresh();
      const event = keyEvent(overrides);
      runtime.handleKeydown(event);
      await settle();
      expect(run).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    });
  }

  it("consumes matching repeat events without dispatching them", async () => {
    const { runtime, run } = createRuntime();
    await runtime.refresh();
    const event = keyEvent({ repeat: true });
    runtime.handleKeydown(event);
    await settle();
    expect(run).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    runtime.handleKeydown(keyEvent());
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("deduplicates pending actions but permits other actions and later retries", async () => {
    const pending = deferred<void>();
    const run = mock<(action: ShortcutAction) => Promise<void>>(() => pending.promise);
    const runtime = createShortcutRuntime({
      getSettings: async () => ({ shortcuts: bindings }),
      run,
      onError: mock<(reason: unknown) => void>(() => {}),
    });
    await runtime.refresh();
    runtime.handleKeydown(keyEvent());
    const duplicate = keyEvent();
    runtime.handleKeydown(duplicate);
    runtime.handleKeydown(keyEvent({ code: "ArrowRight", ctrlKey: true }));
    await settle();
    expect(run.mock.calls.map(([action]) => action)).toEqual(["togglePlayback", "next"]);
    expect(duplicate.preventDefault).toHaveBeenCalledTimes(1);
    expect(duplicate.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    pending.resolve();
    await settle();
    runtime.handleKeydown(keyEvent());
    await settle();
    expect(run.mock.calls.map(([action]) => action)).toEqual([
      "togglePlayback",
      "next",
      "togglePlayback",
    ]);
  });

  it("keeps the latest refresh when an older request finishes later", async () => {
    const older = deferred<SettingsResult>();
    const latest = deferred<SettingsResult>();
    let calls = 0;
    const { runtime, run } = createRuntime(() => (++calls === 1 ? older.promise : latest.promise));
    const firstRefresh = runtime.refresh();
    const secondRefresh = runtime.refresh();
    latest.resolve({
      shortcuts: { ...bindings, togglePlayback: { shortcut: "KeyP", global: false } },
    });
    await secondRefresh;
    older.resolve({ shortcuts: bindings });
    await firstRefresh;
    runtime.handleKeydown(keyEvent());
    runtime.handleKeydown(keyEvent({ code: "KeyP" }));
    await settle();
    expect(run.mock.calls).toEqual([["togglePlayback"]]);
  });

  it("applies a per-action scope change only on refresh and preserves other local actions", async () => {
    const saved = cloneShortcuts(bindings);
    const { runtime, run } = createRuntime(async () => ({ shortcuts: saved }));
    await runtime.refresh();
    saved.togglePlayback.global = true;
    runtime.handleKeydown(keyEvent());
    await settle();
    expect(run.mock.calls).toEqual([["togglePlayback"]]);
    await runtime.refresh();
    const globalEvent = keyEvent();
    runtime.handleKeydown(globalEvent);
    runtime.handleKeydown(keyEvent({ code: "ArrowRight", ctrlKey: true }));
    await settle();
    expect(globalEvent.preventDefault).not.toHaveBeenCalled();
    expect(run.mock.calls).toEqual([["togglePlayback"], ["next"]]);
  });

  it("reports refresh failure without losing existing bindings", async () => {
    const failure = new Error("settings unavailable");
    let calls = 0;
    const { runtime, run, onError } = createRuntime(async () => {
      if (++calls > 1) throw failure;
      return { shortcuts: bindings };
    });
    await runtime.refresh();
    await runtime.refresh();
    expect(onError).toHaveBeenCalledWith(failure);
    runtime.handleKeydown(keyEvent());
    await settle();
    expect(run).toHaveBeenCalledWith("togglePlayback");
  });

  it("ignores failure from a superseded refresh", async () => {
    const older = deferred<SettingsResult>();
    let calls = 0;
    const { runtime, run, onError } = createRuntime(() =>
      ++calls === 1 ? older.promise : Promise.resolve({ shortcuts: bindings }),
    );
    const firstRefresh = runtime.refresh();
    await runtime.refresh();
    older.reject(new Error("stale failure"));
    await firstRefresh;
    runtime.handleKeydown(keyEvent());
    await settle();
    expect(onError).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith("togglePlayback");
  });

  for (const failed of [false, true]) {
    it(`ignores stale settings completion after disposal (failure=${failed})`, async () => {
      const settings = deferred<SettingsResult>();
      const { runtime, run, onError } = createRuntime(() => settings.promise);
      const refresh = runtime.refresh();
      runtime.dispose();
      if (failed) settings.reject(new Error("disposed refresh"));
      else settings.resolve({ shortcuts: bindings });
      await refresh;
      const event = keyEvent();
      runtime.handleKeydown(event);
      await settle();
      expect(run).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  }

  it("invalidates keydown callbacks and pending failure callbacks on disposal", async () => {
    const pending = deferred<void>();
    const run = mock<(action: ShortcutAction) => Promise<void>>(() => pending.promise);
    const onError = mock<(reason: unknown) => void>(() => {});
    const runtime = createShortcutRuntime({
      getSettings: async () => ({ shortcuts: bindings }),
      run,
      onError,
    });
    await runtime.refresh();
    const callback = runtime.handleKeydown;
    callback(keyEvent());
    await settle();
    runtime.dispose();
    callback(keyEvent({ code: "ArrowRight", ctrlKey: true }));
    pending.reject(new Error("disposed action"));
    await settle();
    expect(run.mock.calls).toEqual([["togglePlayback"]]);
    expect(onError).not.toHaveBeenCalled();
  });

  for (const synchronous of [false, true]) {
    it(`reports run failure and releases pending action (synchronous=${synchronous})`, async () => {
      const failure = new Error("action failed");
      const run = mock<(action: ShortcutAction) => Promise<void>>(() => {
        if (synchronous) throw failure;
        return Promise.reject(failure);
      });
      const onError = mock<(reason: unknown) => void>(() => {});
      const runtime = createShortcutRuntime({
        getSettings: async () => ({ shortcuts: bindings }),
        run,
        onError,
      });
      await runtime.refresh();
      runtime.handleKeydown(keyEvent());
      await settle();
      expect(onError.mock.calls).toEqual([[failure]]);
      runtime.handleKeydown(keyEvent());
      await settle();
      expect(run).toHaveBeenCalledTimes(2);
      expect(onError.mock.calls).toEqual([[failure], [failure]]);
    });
  }
});
