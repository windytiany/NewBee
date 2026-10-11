import { afterEach, describe, expect, it } from "bun:test";
import {
  applyInterfaceState,
  captureInterfaceState,
  type BackupInterfaceState,
} from "@/features/backup/interfaceState";
import { evaluateSource, transpileScript } from "../../support/moduleLoader";

class StorageFixture {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
const source = await Bun.file(
  new URL("../../../src/features/backup/interfaceState.ts", import.meta.url),
).text();

function restore(invoke: (command: string) => Promise<unknown>, desktop = true) {
  return evaluateSource<{ restoreInterfaceState: () => Promise<void> }>(transpileScript(source), {
    "@tauri-apps/api/core": { invoke, isTauri: () => desktop },
  }).restoreInterfaceState;
}

describe("backup interface state", () => {
  it("captures only portable working state, not window state or diagnostics", () => {
    const storage = new StorageFixture();
    storage.values.set("newbee.active-page", "Library");
    storage.values.set("newbee.sidebar-layout", '{"leftPaneWidth":240}');
    storage.values.set("window-state", '{"x":1000}');
    storage.values.set("detailed-logging", "true");
    expect(captureInterfaceState(storage)).toEqual({
      "newbee.active-page": "Library",
      "newbee.sidebar-layout": '{"leftPaneWidth":240}',
    });
  });

  it("replaces backed-up keys instead of merging and preserves unrelated storage", () => {
    const storage = new StorageFixture();
    storage.values.set("newbee.active-page", "Playing");
    storage.values.set("newbee.playlist-selection", "99");
    storage.values.set("unrelated", "keep");
    applyInterfaceState({ "newbee.active-page": "Library" }, storage);
    expect(storage.getItem("newbee.active-page")).toBe("Library");
    expect(storage.getItem("newbee.playlist-selection")).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("rolls back every target when storage rejects part of the restored state", () => {
    const storage = new StorageFixture();
    storage.values.set("newbee.active-page", "Playing");
    storage.values.set("newbee.sidebar-layout", "old-layout");
    const before = new Map(storage.values);
    let failed = false;
    const adapter = {
      getItem: (key: string) => storage.getItem(key),
      removeItem: (key: string) => storage.removeItem(key),
      setItem(key: string, value: string) {
        if (key === "newbee.sidebar-layout" && !failed) {
          failed = true;
          throw new Error("storage failure");
        }
        storage.setItem(key, value);
      },
    };
    expect(() =>
      applyInterfaceState(
        { "newbee.active-page": "Library", "newbee.sidebar-layout": "new-layout" },
        adapter,
      ),
    ).toThrow("storage failure");
    expect(storage.values).toEqual(before);
  });

  it("acknowledges only after the entire interface state is applied", async () => {
    const storage = new StorageFixture();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    const calls: string[] = [];
    const state: BackupInterfaceState = { "newbee.active-page": "Playlist" };
    await restore(async (command) => {
      calls.push(command);
      if (command === "get_backup_restore_error") return null;
      if (command === "get_restored_interface_state") return state;
      expect(storage.getItem("newbee.active-page")).toBe("Playlist");
    })();
    expect(calls).toEqual([
      "get_backup_restore_error",
      "get_restored_interface_state",
      "acknowledge_interface_restore",
    ]);
  });

  it("leaves the restore pending when applying storage fails", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("read only");
        },
        removeItem: () => {},
      },
    });
    const calls: string[] = [];
    await expect(
      restore(async (command) => {
        calls.push(command);
        return command === "get_backup_restore_error" ? null : { "newbee.active-page": "Library" };
      })(),
    ).rejects.toThrow("read only");
    expect(calls).not.toContain("acknowledge_interface_restore");
  });

  it("reports backend recovery failures and skips APIs in browser preview", async () => {
    await expect(restore(async () => "restore failed")()).rejects.toThrow("restore failed");
    let calls = 0;
    await restore(async () => {
      calls++;
    }, false)();
    expect(calls).toBe(0);
  });
});
