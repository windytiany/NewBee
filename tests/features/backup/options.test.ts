import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/moduleLoader";
import type { NotificationInput } from "@/shared/notifications/center";

const source = await Bun.file(
  new URL("../../../src/features/backup/components/BackupOptions.vue", import.meta.url),
).text();
const output = compileSfc(source, "src/features/backup/components/BackupOptions.vue", {
  inlineTemplate: false,
});
type Bindings = {
  busy: Vue.Ref<boolean>;
  exportBackup: () => Promise<void>;
  importBackup: () => Promise<void>;
  openBackups: () => Promise<void>;
};
function options({
  invoke = async () => undefined,
  save = async () => "export.newbee",
  open = async () => "import.newbee",
  ask = async () => true,
  desktop = true,
}: {
  invoke?: (command: string, args?: unknown) => Promise<unknown>;
  save?: () => Promise<string | null>;
  open?: () => Promise<string | null>;
  ask?: () => Promise<boolean>;
  desktop?: boolean;
} = {}) {
  const feedback: NotificationInput[] = [];
  const busyEvents: boolean[] = [];
  const component = evaluateSource<{
    default: { setup: (props: object, context: object) => Bindings };
  }>(output, {
    vue: Vue,
    "@tauri-apps/api/core": { invoke, isTauri: () => desktop },
    "@tauri-apps/plugin-dialog": { save, open, ask },
    "@/features/backup/interfaceState": {
      captureInterfaceState: () => ({ "newbee.active-page": "Library" }),
    },
    "@/shared/notifications/center": {
      notify: (notice: NotificationInput) => feedback.push(notice),
    },
  }).default;
  const bindings = component.setup(
    {},
    { expose: () => {}, emit: (_event: string, busy: boolean) => busyEvents.push(busy) },
  );
  return { bindings, feedback, busyEvents };
}

describe("backup options", () => {
  it("exports the persisted interface state to the selected single file", async () => {
    const calls: unknown[] = [];
    const { bindings, feedback, busyEvents } = options({
      invoke: async (command, args) => {
        calls.push([command, args]);
      },
    });
    await bindings.exportBackup();
    expect(calls).toEqual([
      ["export_backup", { path: "export.newbee", interface: { "newbee.active-page": "Library" } }],
    ]);
    expect(feedback[0]).toMatchObject({ type: "success", message: "备份已导出" });
    expect(busyEvents).toEqual([true, false]);
  });

  it("validates before asking for confirmation and imports the inspected snapshot token", async () => {
    const calls: unknown[] = [];
    const { bindings } = options({
      invoke: async (command, args) => {
        calls.push([command, args]);
        return "candidate-token";
      },
      ask: async () => {
        expect(calls).toEqual([["inspect_backup", { path: "import.newbee" }]]);
        return true;
      },
    });
    await bindings.importBackup();
    expect(calls).toEqual([
      ["inspect_backup", { path: "import.newbee" }],
      [
        "restore_backup",
        { token: "candidate-token", interface: { "newbee.active-page": "Library" } },
      ],
    ]);
  });

  it("does not import invalid backups or cancelled confirmations", async () => {
    const calls: string[] = [];
    let confirmations = 0;
    const invalid = options({
      invoke: async (command) => {
        calls.push(command);
        throw new Error("incompatible backup");
      },
      ask: async () => {
        confirmations++;
        return true;
      },
    });
    await invalid.bindings.importBackup();
    expect(calls).toEqual(["inspect_backup"]);
    expect(confirmations).toBe(0);
    expect(invalid.feedback[0]?.message).toContain("incompatible backup");
    const cancelled = options({
      invoke: async (command) => {
        calls.push(command);
        return "token";
      },
      ask: async () => false,
    });
    await cancelled.bindings.importBackup();
    expect(calls).toEqual(["inspect_backup", "inspect_backup"]);
    expect(cancelled.feedback).toEqual([]);
  });

  it("does nothing after file-dialog cancellation or outside the desktop app", async () => {
    let calls = 0;
    const cancelled = options({
      invoke: async () => {
        calls++;
      },
      save: async () => null,
      open: async () => null,
    });
    await cancelled.bindings.exportBackup();
    await cancelled.bindings.importBackup();
    const browser = options({
      desktop: false,
      invoke: async () => {
        calls++;
      },
    });
    await browser.bindings.openBackups();
    await browser.bindings.exportBackup();
    await browser.bindings.importBackup();
    expect(calls).toBe(0);
    expect(cancelled.feedback).toEqual([]);
  });

  it("blocks duplicate operations and permits retry after backend failure", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const calls: string[] = [];
    let fail = true;
    const { bindings, feedback } = options({
      invoke: async (command) => {
        calls.push(command);
        await pending;
        if (fail) throw new Error("write task running");
      },
    });
    const first = bindings.exportBackup();
    await bindings.importBackup();
    await bindings.openBackups();
    expect(bindings.busy.value).toBe(true);
    finish();
    await first;
    expect(calls).toEqual(["export_backup"]);
    expect(feedback[0]?.type).toBe("error");
    expect(bindings.busy.value).toBe(false);
    fail = false;
    await bindings.openBackups();
    expect(calls).toEqual(["export_backup", "open_backups_directory"]);
  });
});
