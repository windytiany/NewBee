import { expect, it } from "bun:test";
import * as Vue from "vue";
import { evaluateSource, transpileScript } from "../../support/module/loader";
import { INBOX_CHANGED_EVENT } from "@/features/inbox/api";
import type { useInboxImport } from "@/features/inbox/import";
import type { OpenDialogOptions } from "@tauri-apps/plugin-dialog";
import type { InboxResult } from "@/features/inbox/api";
import type { NotificationInput } from "@/shared/notifications/center";

const importOutput = transpileScript(await Bun.file("src/features/inbox/import.ts").text());

function createDropImporter(validate: () => Promise<string[]>, results: InboxResult[]) {
  const notices: NotificationInput[] = [];
  const registrations: unknown[] = [];
  const events: string[] = [];
  const module = evaluateSource<{ useInboxImport: typeof useInboxImport }>(importOutput, {
    vue: Vue,
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
    notices,
    registrations,
    events,
    restore: () => {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

it("registers only validated dropped files and excludes duplicates from the notice", async () => {
  const importer = createDropImporter(
    async () => ["good.wav", "duplicate.wav"],
    [
      { path: "good.wav", success: true, skipped: false, error: null },
      { path: "duplicate.wav", success: true, skipped: true, error: null },
    ],
  );
  try {
    await importer.importPaths(["good.wav", "duplicate.wav", "bad.mp3"]);
    expect(importer.registrations).toEqual([[["good.wav", "duplicate.wav"], false]]);
    expect(importer.notices[0]?.message).toBe("已加入 Inbox：1 首");
    expect(importer.events).toEqual([INBOX_CHANGED_EVENT]);
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

it("reports system failures rather than suppressing them for drops", async () => {
  const importer = createDropImporter(
    async () => ["good.wav"],
    [{ path: "good.wav", success: false, error: "database unavailable" }],
  );
  try {
    await importer.importPaths(["good.wav"]);
    expect(importer.notices[0]?.type).toBe("warning");
    expect(importer.pending.value).toBe(false);
  } finally {
    importer.restore();
  }
});

it("uses the existing native import interactions to register paths without importing library snapshots, and does not count duplicates as added", async () => {
  const calls: Array<{ command: string; args: unknown }> = [];
  const pickerOptions: OpenDialogOptions[] = [];
  const notifications: Array<{ message: string }> = [];
  const warnings: unknown[] = [];
  const window = new EventTarget();
  let changes = 0;
  window.addEventListener(INBOX_CHANGED_EVENT, () => {
    changes += 1;
  });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  try {
    const module = evaluateSource<{ useInboxImport: typeof useInboxImport }>(
      transpileScript(await Bun.file("src/features/inbox/import.ts").text()),
      {
        vue: Vue,
        "@tauri-apps/api/core": {
          isTauri: () => true,
          invoke: async (command: string, args: unknown) => {
            calls.push({ command, args });
            return command === "supported_audio_extensions"
              ? ["wav"]
              : [
                  { path: "C:\\music\\new.wav", success: true, skipped: false, error: null },
                  { path: "C:\\music\\duplicate.wav", success: true, skipped: true, error: null },
                ];
          },
        },
        "@tauri-apps/plugin-dialog": {
          open: async (options: OpenDialogOptions) => {
            pickerOptions.push(options);
            return options.directory
              ? ["C:\\music"]
              : ["C:\\music\\new.wav", "C:\\music\\duplicate.wav"];
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
    expect(notifications[0].message).toBe("已加入 Inbox：1 首");
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
    expect(controller.pending.value).toBe(false);
    expect(warnings).toEqual([]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
