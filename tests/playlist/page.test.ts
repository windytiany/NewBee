// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { PlaylistAvailability } from "@/playlist/usePlaylistState";
import type { usePlaylistPage } from "@/playlist/usePage";

const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const output = transpileModule(
  await bunRuntime.Bun.file(new URL("../../src/playlist/usePage.ts", import.meta.url)).text(),
  { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } },
).outputText;
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
  const state = {
    refreshPlaylists: async (playlistId?: number, force?: boolean) => {
      refreshes.push([playlistId, force]);
    },
  };
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/library/changes": { LIBRARY_CHANGED_EVENT: "library-changed" },
    "@/playlist/usePlaylistState": {
      usePlaylistState: (value: typeof availability) => {
        availability = value;
        Vue.watch(value, (mode) => modes.push(mode), { immediate: true, flush: "sync" });
        return state;
      },
    },
  };
  const module = { exports: {} as { usePlaylistPage: typeof usePlaylistPage } };
  new Function("require", "module", "exports", output)(
    (name: string) => {
      if (!(name in modules)) throw new Error(`Missing dependency: ${name}`);
      return modules[name];
    },
    module,
    module.exports,
  );
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
      page = module.exports.usePlaylistPage(active);
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
    expect(harness.page).toBe(harness.state);
    expect(harness.modes).toEqual(["unavailable", "active", "background", "active"]);
    expect(harness.refreshes).toEqual([]);
  });

  for (const active of [true, false]) {
    it(`${active ? "活跃" : "后台"} 页面将媒体库变更转换为强制刷新，卸载后停止订阅`, () => {
      const harness = createPage(active);
      globalThis.window.dispatchEvent(new Event("library-changed"));
      expect(harness.refreshes).toEqual([[undefined, true]]);
      harness.unmount();
      expect(harness.modes[harness.modes.length - 1]).toBe("unavailable");
      globalThis.window.dispatchEvent(new Event("library-changed"));
      harness.active.value = !active;
      expect(harness.refreshes).toHaveLength(1);
      expect(harness.modes[harness.modes.length - 1]).toBe("unavailable");
    });
  }
});
