import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { transpileScript, evaluateSource } from "../../support/module/loader";

import type { PlaylistAvailability } from "@/features/playlist/composables/useState";
import type { usePlaylistPage } from "@/features/playlist/composables/usePage";

const output = transpileScript(
  await Bun.file(
    new URL("../../../src/features/playlist/composables/usePage.ts", import.meta.url),
  ).text(),
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function createPage(initialActive: boolean) {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  const active = Vue.ref(initialActive);
  const modes: PlaylistAvailability[] = [];
  const refreshes: Array<[number | undefined, boolean | undefined]> = [];
  let availability!: Readonly<Vue.Ref<PlaylistAvailability>>;
  const changes: unknown[] = [];
  const state = {
    updateTrackMetadata: (change: unknown) => changes.push(change),
    refreshPlaylists: async (playlistId?: number, force?: boolean) => {
      refreshes.push([playlistId, force]);
    },
  };
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/features/tracks/events": { TRACKS_CHANGED_EVENT: "newbee:tracks-changed" },
    "@/features/playlist/composables/useState": {
      usePlaylistState: (value: typeof availability) => {
        availability = value;
        Vue.watch(value, (mode) => modes.push(mode), { immediate: true, flush: "sync" });
        return state;
      },
    },
  };
  const { usePlaylistPage: createPlaylistPage } = evaluateSource<{
    usePlaylistPage: typeof usePlaylistPage;
  }>(output, modules);
  const renderer = Vue.createRenderer<object>({
    patchProp: () => {},
    insert: () => {},
    remove: () => {},
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null,
  });
  let page!: ReturnType<typeof usePlaylistPage>;
  const app = renderer.createApp({
    setup() {
      page = createPlaylistPage(active);
      expect(availability.value).toBe("unavailable");
      return () => null;
    },
  });
  app.mount({});
  apps.push(app);
  return {
    active,
    modes,
    refreshes,
    changes,
    page,
    state,
    unmount: () => {
      app.unmount();
      apps.splice(apps.indexOf(app), 1);
    },
  };
}

describe("歌单页面 lifecycle adapter", () => {
  it("保持同一份状态，仅向 module 传递可用性变化", () => {
    const harness = createPage(true);
    harness.active.value = false;
    harness.active.value = true;
    expect<object>(harness.page).toBe(harness.state);
    expect(harness.modes).toEqual(["unavailable", "active", "background", "active"]);
    expect(harness.refreshes).toEqual([]);
  });

  for (const active of [true, false]) {
    it(`${active ? "活跃" : "后台"} 页面传递批量曲目变化，卸载后停止订阅`, () => {
      const harness = createPage(active);
      const change = { trackIds: [7] };
      globalThis.window.dispatchEvent(new CustomEvent("newbee:tracks-changed", { detail: change }));
      expect(harness.changes).toEqual([change]);
      expect(harness.refreshes).toEqual([]);
      globalThis.window.dispatchEvent(new CustomEvent("newbee:playlist-changed", { detail: 3 }));
      expect(harness.refreshes).toEqual([[undefined, undefined]]);
      harness.unmount();
      expect(harness.modes[harness.modes.length - 1]).toBe("unavailable");
      globalThis.window.dispatchEvent(new Event("newbee:tracks-changed"));
      harness.active.value = !active;
      expect(harness.refreshes).toHaveLength(1);
      expect(harness.changes).toHaveLength(1);
      expect(harness.modes[harness.modes.length - 1]).toBe("unavailable");
    });
  }
});
