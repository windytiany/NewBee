import { expect, it } from "bun:test";
import * as Vue from "vue";
import { evaluateSource, transpileScript } from "../../support/module/loader";
import { INBOX_CHANGED_EVENT } from "@/features/inbox/api";
import type { useInboxImport } from "@/features/inbox/import";
import type { OpenDialogOptions } from "@tauri-apps/plugin-dialog";

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
