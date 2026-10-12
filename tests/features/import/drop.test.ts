import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import type { useDropImport } from "@/features/import/useDropImport";
import type { NotificationInput } from "@/shared/notifications/center";
import { evaluateSource, transpileScript } from "../../support/module/loader";

const output = transpileScript(await Bun.file("src/features/import/useDropImport.ts").text());
const originals = ["document", "MutationObserver"].map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
);
afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function createDrop({
  desktop = true,
  validate = async () => ["song.wav"],
  subscription,
}: {
  desktop?: boolean;
  validate?: () => Promise<string[]>;
  subscription?: Promise<() => void>;
} = {}) {
  const activePage = Vue.ref("Library");
  const importing = Vue.ref(false);
  const inboxPending = Vue.ref(false);
  const scanning = Vue.ref(false);
  const calls: Array<[string, string[]]> = [];
  const notices: NotificationInput[] = [];
  let modal = false;
  let mount: () => Promise<void> = async () => {};
  let unmount = () => {};
  let mutate = () => {};
  let listener: (event: { payload: DragDropEvent }) => void = () => {};
  let stops = 0;
  let disconnects = 0;
  let registrations = 0;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body: {},
      querySelector: () => (modal ? {} : null),
    },
  });
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        mutate = callback;
      }
      observe() {}
      disconnect() {
        disconnects += 1;
      }
    },
  });
  const module = evaluateSource<{ useDropImport: typeof useDropImport }>(output, {
    vue: {
      ...Vue,
      onMounted: (callback: typeof mount) => {
        mount = callback;
      },
      onUnmounted: (callback: typeof unmount) => {
        unmount = callback;
      },
    },
    "@tauri-apps/api/core": { isTauri: () => desktop, invoke: validate },
    "@tauri-apps/api/webview": {
      getCurrentWebview: () => ({
        onDragDropEvent: async (callback: typeof listener) => {
          registrations += 1;
          listener = callback;
          return (
            subscription ??
            (() => {
              stops += 1;
            })
          );
        },
      }),
    },
    "@/features/library/import/useFileImport": {
      useLibraryFileImport: () => ({
        isImporting: importing,
        importPaths: async (paths: string[]) => {
          calls.push(["Library", paths]);
        },
      }),
    },
    "@/features/inbox/import": {
      useInboxImport: () => ({
        pending: inboxPending,
        importPaths: async (paths: string[]) => {
          calls.push(["Inbox", paths]);
        },
      }),
    },
    "@/features/library/import/useScan": { useLibraryScan: () => ({ isScanning: scanning }) },
    "@/shared/notifications/center": {
      notify: (notice: NotificationInput) => notices.push(notice),
    },
    "@/shared/logging/logger": { logger: { error: () => {} } },
  });
  const controller = module.useDropImport(activePage);
  return {
    ...controller,
    mount,
    unmount,
    activePage,
    importing,
    inboxPending,
    scanning,
    calls,
    notices,
    counts: () => ({ stops, disconnects, registrations }),
    setModal: (value: boolean) => {
      modal = value;
      mutate();
    },
    emit: async (type: "enter" | "drop" | "leave", paths = ["song.wav"]) => {
      listener({
        payload:
          type === "leave" ? { type } : { type, paths, position: new PhysicalPosition(0, 0) },
      });
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

it("uses the page at drop time and never imports on other pages", async () => {
  const drop = createDrop();
  await drop.mount();
  await drop.emit("enter");
  expect(drop.label.value).toBe("导入音乐库");
  drop.activePage.value = "Inbox";
  expect(drop.label.value).toBe("导入 Inbox");
  await drop.emit("drop");
  expect(drop.calls).toEqual([["Inbox", ["song.wav"]]]);
  expect(drop.label.value).toBe("");
  await drop.emit("drop");
  drop.activePage.value = "Library";
  await drop.emit("drop", ["other.wav"]);
  for (const page of ["Playlist", "Playing"]) {
    drop.activePage.value = page;
    await drop.emit("enter");
    expect(drop.label.value).toBe("");
    await drop.emit("drop");
  }
  expect(drop.calls).toHaveLength(3);
  expect(drop.calls[2]).toEqual(["Library", ["other.wav"]]);
  drop.unmount();
  expect(drop.counts()).toMatchObject({ stops: 1, disconnects: 1 });
});

it("hides feedback and disables drops whenever a dialog is open", async () => {
  const drop = createDrop();
  await drop.mount();
  await drop.emit("enter");
  drop.setModal(true);
  expect(drop.label.value).toBe("");
  await drop.emit("drop");
  expect(drop.calls).toEqual([]);
  expect(drop.notices).toEqual([]);
  drop.setModal(false);
  await drop.emit("drop");
  expect(drop.calls).toHaveLength(1);
  drop.unmount();
});

it("rejects new drops with a busy notice during either import or scanning", async () => {
  const drop = createDrop();
  await drop.mount();
  for (const pending of [drop.importing, drop.inboxPending, drop.scanning]) {
    await drop.emit("enter");
    pending.value = true;
    expect(drop.label.value).toBe("");
    await drop.emit("drop");
    pending.value = false;
  }
  expect(drop.calls).toEqual([]);
  expect(drop.notices.map((notice) => notice.message)).toEqual(Array(3).fill("导入进行中"));
  drop.unmount();
});

it("does not highlight invalid files or restore stale feedback after leaving or dropping", async () => {
  const invalid = createDrop({ validate: async () => [] });
  await invalid.mount();
  await invalid.emit("enter");
  expect(invalid.label.value).toBe("");
  invalid.unmount();
  for (const ending of ["leave", "drop"] as const) {
    const validation = deferred<string[]>();
    const drop = createDrop({ validate: () => validation.promise });
    await drop.mount();
    await drop.emit("enter");
    await drop.emit(ending);
    validation.resolve(["song.wav"]);
    await Promise.resolve();
    expect(drop.label.value).toBe("");
    drop.unmount();
  }
});

it("releases subscriptions that finish registering after unmount", async () => {
  let stops = 0;
  const subscription = deferred<() => void>();
  const drop = createDrop({ subscription: subscription.promise });
  const mounted = drop.mount();
  drop.unmount();
  subscription.resolve(() => {
    stops += 1;
  });
  await mounted;
  await drop.emit("drop");
  expect(stops).toBe(1);
  expect(drop.calls).toEqual([]);
});

it("does not access native or DOM APIs in browser preview", async () => {
  const drop = createDrop({ desktop: false });
  await drop.mount();
  expect(drop.counts().registrations).toBe(0);
  drop.unmount();
});
