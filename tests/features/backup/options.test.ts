import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/module/loader";
import type { NotificationInput } from "@/shared/notifications/center";

const source = await Bun.file(
  new URL("../../../src/features/backup/components/BackupOptions.vue", import.meta.url),
).text();
const output = compileSfc(source, "src/features/backup/components/BackupOptions.vue", {
  inlineTemplate: false,
});
type Bindings = {
  busy: Vue.Ref<boolean>;
  backupCurrent: Vue.Ref<boolean>;
  confirmationDialog: Vue.Ref<{ showModal: () => void; close: () => void } | null>;
  finishConfirmation: (confirmed: boolean) => void;
  exportBackup: () => Promise<void>;
  importBackup: () => Promise<void>;
  openBackups: () => Promise<void>;
};
function options({
  invoke = async () => undefined,
  save = async () => "export.newbee",
  open = async () => "import.newbee",
  desktop = true,
}: {
  invoke?: (command: string, args?: unknown) => Promise<unknown>;
  save?: () => Promise<string | null>;
  open?: () => Promise<string | null>;
  desktop?: boolean;
} = {}) {
  const feedback: NotificationInput[] = [];
  const busyEvents: boolean[] = [];
  const dialogEvents: string[] = [];
  let opened!: () => void;
  let unmount = () => {};
  const confirmationOpened = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const component = evaluateSource<{
    default: { setup: (props: object, context: object) => Bindings };
  }>(output, {
    vue: { ...Vue, onBeforeUnmount: (callback: () => void) => (unmount = callback) },
    "@tauri-apps/api/core": { invoke, isTauri: () => desktop },
    "@tauri-apps/plugin-dialog": { save, open },
    "@/features/backup/interface": {
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
  bindings.confirmationDialog.value = {
    showModal: () => {
      dialogEvents.push("open");
      opened();
    },
    close: () => dialogEvents.push("close"),
  };
  return { bindings, feedback, busyEvents, dialogEvents, confirmationOpened, unmount };
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

  it("validates before confirmation and backs up current state by default", async () => {
    const calls: unknown[] = [];
    const { bindings, confirmationOpened, busyEvents } = options({
      invoke: async (command, args) => {
        calls.push([command, args]);
        return "candidate-token";
      },
    });
    const importing = bindings.importBackup();
    await confirmationOpened;
    expect(calls).toEqual([["inspect_backup", { path: "import.newbee" }]]);
    expect(bindings.backupCurrent.value).toBe(true);
    expect(bindings.busy.value).toBe(true);
    await bindings.importBackup();
    bindings.finishConfirmation(true);
    await importing;
    expect(busyEvents).toEqual([true, false]);
    expect(calls).toEqual([
      ["inspect_backup", { path: "import.newbee" }],
      [
        "restore_backup",
        {
          token: "candidate-token",
          interface: { "newbee.active-page": "Library" },
          backupCurrent: true,
        },
      ],
    ]);
  });

  it("does not import invalid backups or cancelled confirmations", async () => {
    const calls: string[] = [];
    const invalid = options({
      invoke: async (command) => {
        calls.push(command);
        throw new Error("incompatible backup");
      },
    });
    await invalid.bindings.importBackup();
    expect(calls).toEqual(["inspect_backup"]);
    expect(invalid.dialogEvents).toEqual([]);
    expect(invalid.feedback[0]?.message).toContain("incompatible backup");
    const cancelled = options({
      invoke: async (command) => {
        calls.push(command);
        return "token";
      },
    });
    const importing = cancelled.bindings.importBackup();
    await cancelled.confirmationOpened;
    cancelled.bindings.finishConfirmation(false);
    await importing;
    expect(calls).toEqual(["inspect_backup", "inspect_backup"]);
    expect(cancelled.feedback).toEqual([]);
  });

  it("lets users skip the safety backup and resets the choice on the next import", async () => {
    const calls: unknown[] = [];
    const { bindings, confirmationOpened } = options({
      invoke: async (command, args) => {
        calls.push([command, args]);
        return "token";
      },
    });
    const importing = bindings.importBackup();
    await confirmationOpened;
    bindings.backupCurrent.value = false;
    bindings.finishConfirmation(true);
    await importing;
    expect(calls[1]).toEqual([
      "restore_backup",
      { token: "token", interface: { "newbee.active-page": "Library" }, backupCurrent: false },
    ]);
    const retry = bindings.importBackup();
    await Vue.nextTick();
    await Vue.nextTick();
    expect(bindings.backupCurrent.value).toBe(true);
    bindings.finishConfirmation(false);
    await retry;
    expect(calls).toHaveLength(3);
  });

  it("cancels pending confirmation on unmount without restoring", async () => {
    const calls: string[] = [];
    const view = options({
      invoke: async (command) => {
        calls.push(command);
        return "token";
      },
    });
    const importing = view.bindings.importBackup();
    await view.confirmationOpened;
    view.unmount();
    await importing;
    expect(calls).toEqual(["inspect_backup"]);
    expect(view.bindings.busy.value).toBe(false);
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
