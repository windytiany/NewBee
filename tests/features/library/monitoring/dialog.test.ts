import { expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import type { MonitoringSnapshot } from "@/features/library/monitoring/types";

const source = compileSfc(
  await Bun.file("src/features/library/monitoring/MonitoringDialog.vue").text(),
  "MonitoringDialog.vue",
  { inlineTemplate: false },
);

type Bindings = {
  dialog: Vue.Ref<{ open: boolean; showModal: () => void; close: () => void }>;
  paths: Vue.Ref<string[]>;
  pending: Vue.Ref<boolean>;
  resolve: (clean: boolean) => Promise<void>;
};

function fixture() {
  const snapshot = Vue.shallowRef<MonitoringSnapshot>({ statuses: [], missing: [] });
  const resolutions: unknown[] = [];
  const notices: unknown[] = [];
  const imports: unknown[] = [];
  const metadata: unknown[] = [];
  const listeners = new Map<
    string,
    (event: { payload: { added: number; updated: number } }) => void
  >();
  const unlistened: string[] = [];
  let mount = () => {};
  let unmount = () => {};
  let removals = 0;
  let fail = false;
  let next = ["first.wav"];
  const component = evaluateSource<{
    default: { setup: (props: object, context: object) => Bindings };
  }>(source, {
    vue: {
      ...Vue,
      onMounted: (callback: () => void) => {
        mount = callback;
      },
      onUnmounted: (callback: () => void) => {
        unmount = callback;
      },
    },
    "@tauri-apps/api/core": { isTauri: () => true, invoke: async () => [] },
    "@tauri-apps/api/event": {
      listen: async (
        name: string,
        callback: (event: { payload: { added: number; updated: number } }) => void,
      ) => {
        listeners.set(name, callback);
        return () => {
          unlistened.push(name);
        };
      },
    },
    "@/features/library/monitoring/state": {
      monitoringSnapshot: snapshot,
      refreshMonitoring: async () => {
        snapshot.value = { statuses: [], missing: [...next] };
      },
      resolveMonitoring: async (paths: string[], clean: boolean) => {
        resolutions.push([[...paths], clean]);
        if (fail) throw new Error("busy");
        next = next.filter((path) => !paths.includes(path));
        snapshot.value = { statuses: [], missing: [...next] };
        return clean ? paths.length : 0;
      },
    },
    "@/features/library/events": {
      reportLibraryImport: (result: unknown) => imports.push(result),
      reportLibraryMembershipChanged: () => {
        removals += 1;
      },
    },
    "@/features/playback/session": {
      usePlaybackSession: () => ({
        ready: Promise.resolve(),
        state: { displayedTracks: Vue.ref([{ trackId: 7 }]) },
      }),
    },
    "@/features/tracks/synchronize": {
      createTrackSynchronization: () => ({
        refresh: async (ids: number[]) => {
          metadata.push(ids);
        },
      }),
    },
    "@/shared/notifications/center": { notify: (input: unknown) => notices.push(input) },
  }).default;
  const bindings = component.setup({}, { expose: () => {} });
  const dialog = {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };
  bindings.dialog.value = dialog;
  return {
    bindings,
    dialog,
    snapshot,
    resolutions,
    notices,
    imports,
    metadata,
    listeners,
    unlistened,
    mount: () => mount(),
    unmount: () => unmount(),
    setNext: (paths: string[]) => {
      next = paths;
    },
    setFail: (value: boolean) => {
      fail = value;
    },
    removals: () => removals,
  };
}

it("subscribes before fetching startup changes and queues new missing files without stacking dialogs", async () => {
  const test = fixture();
  test.mount();
  await Bun.sleep(0);
  expect(test.listeners.size).toBe(2);
  expect(test.dialog.open).toBe(true);
  expect(test.bindings.paths.value).toEqual(["first.wav"]);
  test.setNext(["first.wav", "later.wav"]);
  test.snapshot.value = { statuses: [], missing: ["first.wav", "later.wav"] };
  await Vue.nextTick();
  expect(test.bindings.paths.value).toEqual(["first.wav"]);
  await test.bindings.resolve(false);
  expect(test.resolutions).toEqual([[["first.wav"], false]]);
  expect(test.bindings.paths.value).toEqual(["later.wav"]);
  expect(test.removals()).toBe(0);
  await test.bindings.resolve(true);
  expect(test.removals()).toBe(1);
  expect(test.dialog.open).toBe(false);
  test.unmount();
  expect(test.unlistened).toHaveLength(2);
});

it("reports backend failures once as notifications without persistent row status text", async () => {
  const test = fixture();
  const status = { path: "D:/Music", phase: "error" as const, error: "Unreadable audio" };
  test.snapshot.value = { statuses: [status], missing: [] };
  await Vue.nextTick();
  expect(test.notices).toHaveLength(1);
  test.snapshot.value = { statuses: [status], missing: [] };
  await Vue.nextTick();
  expect(test.notices).toHaveLength(1);
  test.snapshot.value = { statuses: [], missing: [] };
  await Vue.nextTick();
  test.snapshot.value = { statuses: [status], missing: [] };
  await Vue.nextTick();
  expect(test.notices).toHaveLength(2);
  test.unmount();
});

it("keeps a failed confirmation open for retry", async () => {
  const test = fixture();
  test.mount();
  await Bun.sleep(0);
  test.setFail(true);
  await test.bindings.resolve(true);
  expect(test.dialog.open).toBe(true);
  expect(test.bindings.paths.value).toEqual(["first.wav"]);
  expect(test.bindings.pending.value).toBe(false);
  expect(test.notices).toHaveLength(1);
  test.setFail(false);
  await test.bindings.resolve(true);
  expect(test.dialog.open).toBe(false);
  test.unmount();
});

it("refreshes library membership and displayed playback metadata after monitored imports", async () => {
  const test = fixture();
  test.mount();
  await Bun.sleep(0);
  test.listeners.get("library-monitoring-imported")!({ payload: { added: 1, updated: 2 } });
  await Bun.sleep(0);
  expect(test.imports[test.imports.length - 1]).toEqual({ added: 1, updated: 2 });
  expect(test.metadata[test.metadata.length - 1]).toEqual([7]);
  test.unmount();
});
