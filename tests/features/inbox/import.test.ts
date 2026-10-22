import { expect, it } from "bun:test";
import * as Vue from "vue";
import { createTaskCenter } from "@/shared/tasks/state";
import { evaluateSource, transpileScript } from "../../support/module/loader";
import { INBOX_CHANGED_EVENT } from "@/features/inbox/api";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import type { useInboxImport } from "@/features/inbox/useImport";
import type { OpenDialogOptions } from "@tauri-apps/plugin-dialog";
import type { InboxResult } from "@/features/inbox/api";
import type { NotificationInput } from "@/shared/notifications/center";

const importOutput = transpileScript(await Bun.file("src/features/inbox/useImport.ts").text());

function createDropImporter(validate: () => Promise<string[]>, results: InboxResult[]) {
  const tasks = createTaskCenter();
  const notices: NotificationInput[] = [];
  const registrations: unknown[] = [];
  const events: string[] = [];
  const module = evaluateSource<{ useInboxImport: typeof useInboxImport }>(importOutput, {
    vue: Vue,
    "@/shared/tasks/state": { tasks },
    "@tauri-apps/api/core": { isTauri: () => true, invoke: validate },
    "@tauri-apps/plugin-dialog": {
      open: () => {
        throw new Error("Unexpected picker");
      },
    },
    "@/features/inbox/api": {
      INBOX_CHANGED_EVENT,
      createInboxApi: () => ({
        register: async (...args: unknown[]) => {
          registrations.push(args);
          return results;
        },
      }),
    },
    "@/features/library/events": {
      reportLibraryMembershipChanged: () => {
        globalThis.window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
      },
    },
    "@/shared/notifications/center": {
      notify: (notice: NotificationInput) => notices.push(notice),
    },
    "@/shared/logging/logger": { logger: { warn: () => {}, error: () => {} } },
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => events.push(event.type),
    },
  });
  return {
    ...module.useInboxImport(),
    tasks,
    notices,
    registrations,
    events,
    restore: () => {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

it("tracks Inbox imports during discovery and removes the task after an empty batch", async () => {
  let resolve!: (paths: string[]) => void;
  const discovery = new Promise<string[]>((finish) => {
    resolve = finish;
  });
  const importer = createDropImporter(() => discovery, []);
  try {
    const pending = importer.importPaths(["/Music"]);
    expect(importer.tasks.active.value).toHaveLength(1);
    resolve([]);
    await pending;
    expect(importer.tasks.active.value).toEqual([]);
    expect(importer.pending.value).toBe(false);
  } finally {
    resolve([]);
    importer.restore();
  }
});

it("registers validated dropped files and refreshes Inbox without a success notice", async () => {
  const importer = createDropImporter(
    async () => ["good.wav", "duplicate.wav"],
    [
      { trackId: 1, path: "good.wav", success: true, skipped: false, error: null },
      { trackId: 1, path: "duplicate.wav", success: true, skipped: false, error: null },
    ],
  );
  try {
    await importer.importPaths(["good.wav", "duplicate.wav", "bad.mp3"]);
    expect(importer.registrations).toEqual([[["good.wav", "duplicate.wav"], false]]);
    expect(importer.notices).toEqual([]);
    expect(importer.events).toEqual([LIBRARY_CHANGED_EVENT, INBOX_CHANGED_EVENT]);
  } finally {
    importer.restore();
  }
});

it("refreshes the library after rescanning an existing registration", async () => {
  const importer = createDropImporter(
    async () => ["duplicate.wav", "failed.wav"],
    [
      { trackId: 1, path: "duplicate.wav", success: true, skipped: false, error: null },
      {
        trackId: null,
        path: "failed.wav",
        success: false,
        skipped: false,
        error: "database unavailable",
      },
    ],
  );
  try {
    await importer.importPaths(["duplicate.wav", "failed.wav"]);
    expect(importer.events).toEqual([LIBRARY_CHANGED_EVENT, INBOX_CHANGED_EVENT]);
  } finally {
    importer.restore();
  }
});

it("silently ignores invalid drops and releases the Inbox pending state", async () => {
  const importer = createDropImporter(async () => [], []);
  try {
    await importer.importPaths(["bad.mp3"]);
    expect(importer.registrations).toEqual([]);
    expect(importer.notices).toEqual([]);
    expect(importer.events).toEqual([]);
    expect(importer.pending.value).toBe(false);
  } finally {
    importer.restore();
  }
});

it("retains partial failure warnings while refreshing successful dropped registrations", async () => {
  const importer = createDropImporter(
    async () => ["good.wav", "failed.wav"],
    [
      { trackId: 1, skipped: false, path: "good.wav", success: true, error: null },
      {
        trackId: null,
        skipped: false,
        path: "failed.wav",
        success: false,
        error: "database unavailable",
      },
    ],
  );
  try {
    await importer.importPaths(["good.wav", "failed.wav"]);
    expect(importer.notices).toEqual([
      { type: "warning", message: "1 首导入失败。无法完成扫描。", key: "inbox-import" },
    ]);
    expect(importer.events).toEqual([LIBRARY_CHANGED_EVENT, INBOX_CHANGED_EVENT]);
    expect(importer.pending.value).toBe(false);
  } finally {
    importer.restore();
  }
});

it("reports unexpected drop errors and releases the pending state", async () => {
  const importer = createDropImporter(async () => {
    throw new Error("validation failed");
  }, []);
  try {
    await importer.importPaths(["good.wav"]);
    expect(importer.notices).toEqual([
      { type: "error", message: "导入失败。无法完成扫描。", key: "inbox-import" },
    ]);
    expect(importer.events).toEqual([]);
    expect(importer.pending.value).toBe(false);
  } finally {
    importer.restore();
  }
});

it("reports system failures rather than suppressing them for drops", async () => {
  const importer = createDropImporter(
    async () => ["good.wav"],
    [
      {
        trackId: null,
        skipped: false,
        path: "good.wav",
        success: false,
        error: "database unavailable",
      },
    ],
  );
  try {
    await importer.importPaths(["good.wav"]);
    expect(importer.notices[0]?.type).toBe("warning");
    expect(importer.pending.value).toBe(false);
  } finally {
    importer.restore();
  }
});

it("registers picked files and folders and refreshes Inbox without success notices", async () => {
  const tasks = createTaskCenter();
  const calls: Array<{ command: string; args: unknown }> = [];
  const pickerOptions: OpenDialogOptions[] = [];
  const notifications: Array<{ message: string }> = [];
  const warnings: unknown[] = [];
  const window = new EventTarget();
  let changes = 0;
  let libraryChanges = 0;
  window.addEventListener(LIBRARY_CHANGED_EVENT, () => {
    libraryChanges += 1;
  });
  window.addEventListener(INBOX_CHANGED_EVENT, () => {
    changes += 1;
  });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  try {
    const module = evaluateSource<{ useInboxImport: typeof useInboxImport }>(
      transpileScript(await Bun.file("src/features/inbox/useImport.ts").text()),
      {
        vue: Vue,
        "@/shared/tasks/state": { tasks },
        "@tauri-apps/api/core": {
          isTauri: () => true,
          invoke: async (command: string, args: unknown) => {
            // Task registration belongs to the command queue, adapted separately here.
            expect(tasks.active.value).toHaveLength(0);
            calls.push({ command, args });
            return command === "supported_audio_extensions"
              ? ["wav"]
              : [
                  {
                    trackId: 1,
                    path: "C:\\music\\new.wav",
                    success: true,
                    skipped: false,
                    error: null,
                  },
                  {
                    trackId: 1,
                    path: "C:\\music\\duplicate.wav",
                    success: true,
                    skipped: false,
                    error: null,
                  },
                ];
          },
        },
        "@tauri-apps/plugin-dialog": {
          open: async (options: OpenDialogOptions) => {
            expect(tasks.active.value).toEqual([]);
            pickerOptions.push(options);
            return options.directory
              ? ["C:\\music"]
              : ["C:\\music\\new.wav", "C:\\music\\duplicate.wav"];
          },
        },
        "@/features/library/events": {
          reportLibraryMembershipChanged: () => {
            globalThis.window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
          },
        },
        "@/shared/notifications/center": {
          notify: (notification: { message: string }) => {
            notifications.push(notification);
          },
        },
        "@/shared/logging/logger": {
          logger: {
            warn: (...values: unknown[]) => warnings.push(values),
            error: (...values: unknown[]) => {
              throw new Error(`Unexpected error: ${values}`);
            },
          },
        },
      },
    );
    const controller = module.useInboxImport();
    await controller.importFiles(false);
    expect(pickerOptions[0]).toMatchObject({
      directory: false,
      multiple: true,
      filters: [{ name: "支持的音频文件", extensions: ["wav"] }],
    });
    expect(calls[1]).toEqual({
      command: "register_inbox",
      args: { paths: ["C:\\music\\new.wav", "C:\\music\\duplicate.wav"], directory: false },
    });
    expect(notifications).toEqual([]);
    await controller.importFiles(true);
    expect(pickerOptions[1].directory).toBe(true);
    expect(pickerOptions[1].filters).toBeUndefined();
    expect(calls[3]).toEqual({
      command: "register_inbox",
      args: { paths: ["C:\\music"], directory: true },
    });
    expect(calls.map((call) => call.command)).toEqual([
      "supported_audio_extensions",
      "register_inbox",
      "supported_audio_extensions",
      "register_inbox",
    ]);
    expect(changes).toBe(2);
    expect(libraryChanges).toBe(2);
    expect(notifications).toEqual([]);
    expect(controller.pending.value).toBe(false);
    expect(warnings).toEqual([]);
    expect(tasks.active.value).toEqual([]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
