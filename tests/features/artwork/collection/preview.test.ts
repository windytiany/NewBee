import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as Vue from "vue";
import type { DisplaySelection, DraftPicture } from "@/features/artwork/collection/types";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";
const source = await Bun.file("src/features/artwork/collection/ArtworkPreview.vue").text();
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});
function picture(key: string, data?: number[]): DraftPicture {
  return {
    key,
    mimeType: "image/png",
    byteLength: 3,
    storage: "embedded",
    path: "",
    error: null,
    contentId: key,
    picture: data
      ? { source: "embedded", data, pictureType: 3 }
      : { source: "existing", artworkId: 42, pictureType: 3 },
  };
}
async function settle() {
  await Vue.nextTick();
  await Vue.nextTick();
}
function mount(
  selection: DisplaySelection,
  read: (id: number, size?: null | number) => Promise<ArrayBuffer> = async () =>
    Uint8Array.from([0, 255, 3]).buffer,
  save: (data: number[], current: () => boolean) => Promise<void> = async () => {},
  sideActions = false,
  readFile: (path: string) => Promise<number[]> = async () => [1, 2, 3],
  exportMenu = false,
) {
  const props = Vue.reactive({ selection, disabled: false });
  const failures: unknown[] = [];
  const calls: Array<{ id: number; size: null | number }> = [];
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "ArtworkPreview.vue"),
    {
      vue: Vue,
      "@/features/artwork/collection/api": {
        createArtworkCollectionApi: () => ({
          readFile,
          picture: (id: number, size: null | number = null) => {
            calls.push({ id, size });
            return read(id, size);
          },
        }),
      },
      "@/features/artwork/transfer": { saveCover: save },
      "@/shared/interaction/useContextMenu": {
        useContextMenu: () => {
          const request = Vue.ref<null | { x: number; y: number }>(null);
          const position = Vue.ref({ x: 0, y: 0 });
          return {
            request,
            position,
            open: (value: { x: number; y: number }) => {
              request.value = value;
              position.value = { x: value.x, y: value.y };
            },
            close: () => {
              request.value = null;
            },
          };
        },
      },
    },
  ).default;
  const root = createHostNode("root");
  const app = createHostRenderer((type, text) =>
    createHostNode(type, type === "#comment" ? "" : text),
  ).createApp({
    setup: () => () =>
      Vue.h(
        component,
        {
          ...props,
          exportable: true,
          exportMenu,
          onFailed: (error: unknown) => failures.push(error),
        },
        sideActions
          ? {
              details: () => Vue.h("div", "用途类型"),
              actions: ({ save, disabled }: { save: () => Promise<void>; disabled: boolean }) =>
                Vue.h("button", { type: "button", disabled, onClick: save }, "保存封面"),
            }
          : undefined,
      ),
  });
  app.mount(root);
  apps.push(app);
  return { root, app, props, failures, calls };
}
function button(root: HostNode) {
  const node = findNode(root, (entry) => entry.type === "button");
  if (!node) throw new Error("Missing export button");
  return node;
}
function click(node: HostNode) {
  return (node.props.onClick as () => Promise<void>)();
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}

describe("read-only artwork preview", () => {
  it("exports from the picture context menu without a permanent save button", async () => {
    const saved: number[][] = [];
    const { root, props } = mount(
      { mixed: false, picture: picture("original") },
      undefined,
      async (data) => {
        saved.push(data);
      },
      false,
      undefined,
      true,
    );
    await settle();
    expect(findNode(root, (node) => node.type === "button")).toBeNull();
    const trigger = findNode(root, (node) => node.props["aria-haspopup"] === "menu");
    if (!trigger) throw new Error("Missing picture menu trigger");
    const open = trigger.props.onContextmenu as (event: {
      clientX: number;
      clientY: number;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void;
    const event = { clientX: 10, clientY: 20, preventDefault: () => {}, stopPropagation: () => {} };
    open(event);
    await settle();
    expect(button(root).props.role).toBe("menuitem");
    expect(getTextContent(root)).toBe("保存封面");
    await click(button(root));
    await settle();
    expect(saved).toEqual([[0, 255, 3]]);
    expect(findNode(root, (node) => node.props.role === "menu")).toBeNull();
    open(event);
    await settle();
    props.selection = { mixed: true, picture: null };
    await settle();
    expect(findNode(root, (node) => node.props.role === "menu")).toBeNull();
    open(event);
    await settle();
    expect(button(root).props.disabled).toBe(true);
    await click(button(root));
    expect(saved).toHaveLength(1);
    props.disabled = true;
    await settle();
    open(event);
    await settle();
    expect(findNode(root, (node) => node.props.role === "menu")).toBeNull();
  });
  it("exports original bytes from side actions and keeps their disabled state in sync", async () => {
    const saved: number[][] = [];
    const { root, props } = mount(
      { mixed: false, picture: picture("original") },
      undefined,
      async (data) => {
        saved.push(data);
      },
      true,
    );
    await settle();
    expect(getTextContent(root)).toBe("用途类型保存封面");
    expect(button(root).props.disabled).toBe(false);
    await click(button(root));
    expect(saved).toEqual([[0, 255, 3]]);
    props.disabled = true;
    await settle();
    expect(button(root).props.disabled).toBe(true);
    await click(button(root));
    expect(saved).toHaveLength(1);
  });
  it("exports original binary content without thumbnails or editing controls", async () => {
    const saved: number[][] = [];
    const { root, calls } = mount(
      { mixed: false, picture: picture("original") },
      undefined,
      async (data, current) => {
        expect(current()).toBe(true);
        saved.push(data);
      },
    );
    await settle();
    expect(calls).toEqual([{ id: 42, size: null }]);
    expect(findNode(root, (node) => node.type === "img")?.props.src).toMatch(/^blob:/);
    await click(button(root));
    expect(saved).toEqual([[0, 255, 3]]);
    expect(findNode(root, (node) => node.props.type === "file")).toBeNull();
    expect(getTextContent(root)).toBe("保存封面");
  });
  it("exports new draft bytes without fetching existing content", async () => {
    const saved: number[][] = [];
    const { root, calls } = mount(
      { mixed: false, picture: picture("new", [255, 0, 4]) },
      undefined,
      async (data) => {
        saved.push(data);
      },
    );
    await settle();
    await click(button(root));
    expect(saved).toEqual([[255, 0, 4]]);
    expect(calls).toEqual([]);
  });
  for (const selection of [
    { mixed: true, picture: null },
    { mixed: false, picture: null },
  ] satisfies DisplaySelection[]) {
    it(`does not fetch or export ${selection.mixed ? "mixed" : "empty"} display`, async () => {
      const { root, calls } = mount(selection);
      await settle();
      expect(findNode(root, (node) => node.type === "img")).toBeNull();
      expect(button(root).props.disabled).toBe(true);
      expect(calls).toEqual([]);
      expect(getTextContent(root)).toContain(selection.mixed ? "多个值" : "暂无封面");
    });
  }
  it("shows loading and error states without enabling export", async () => {
    const pending = deferred<ArrayBuffer>();
    const { root } = mount({ mixed: false, picture: picture("a") }, () => pending.promise);
    expect(button(root).props.disabled).toBe(true);
    expect(getTextContent(root)).toContain("封面加载中");
    pending.reject(new Error("content failed"));
    await settle();
    expect(getTextContent(root)).toContain("content failed");
    expect(button(root).props.disabled).toBe(true);
  });
  for (const failure of [false, true]) {
    it(`ignores stale preview ${failure ? "errors" : "bytes"}`, async () => {
      const pending = deferred<ArrayBuffer>();
      const { root, props } = mount({ mixed: false, picture: picture("a") }, () => pending.promise);
      props.selection = { mixed: false, picture: picture("b", [5]) };
      await settle();
      const url = findNode(root, (node) => node.type === "img")?.props.src;
      if (failure) pending.reject(new Error("obsolete"));
      else pending.resolve(Uint8Array.from([1]).buffer);
      await settle();
      expect(findNode(root, (node) => node.type === "img")?.props.src).toBe(url);
      expect(getTextContent(root)).not.toContain("obsolete");
    });
  }
  it("revokes replaced and unmounted URLs and ignores late unmounted reads", async () => {
    const revoke = spyOn(URL, "revokeObjectURL");
    try {
      const { root, props, app } = mount({ mixed: false, picture: picture("a", [1]) });
      await settle();
      const first = findNode(root, (node) => node.type === "img")?.props.src;
      props.selection = { mixed: false, picture: picture("b", [2]) };
      await settle();
      expect(revoke).toHaveBeenCalledWith(first);
      const second = findNode(root, (node) => node.type === "img")?.props.src;
      app.unmount();
      expect(revoke).toHaveBeenCalledWith(second);
      const pending = deferred<ArrayBuffer>();
      const late = mount({ mixed: false, picture: picture("late") }, () => pending.promise);
      late.app.unmount();
      pending.resolve(Uint8Array.from([3]).buffer);
      await settle();
      expect(late.calls).toHaveLength(1);
    } finally {
      revoke.mockRestore();
    }
  });
  it("invalidates a pending export on selection change, disable and unmount", async () => {
    for (const change of ["selection", "disable", "unmount"]) {
      let current: () => boolean = () => false;
      const pending = deferred<void>();
      const { root, props, app } = mount(
        { mixed: false, picture: picture("a", [1]) },
        undefined,
        async (_data, isCurrent) => {
          current = isCurrent;
          await pending.promise;
        },
      );
      await settle();
      const exporting = click(button(root));
      expect(current()).toBe(true);
      if (change === "selection") props.selection = { mixed: true, picture: null };
      else if (change === "disable") props.disabled = true;
      else app.unmount();
      await settle();
      expect(current()).toBe(false);
      pending.resolve();
      await exporting;
    }
  });
  it("reports export errors without changing display", async () => {
    const error = new Error("write failed");
    const { root, failures } = mount(
      { mixed: false, picture: picture("a", [1]) },
      undefined,
      async () => {
        throw error;
      },
    );
    await settle();
    await click(button(root));
    expect(failures).toEqual([error]);
    expect(findNode(root, (node) => node.type === "img")).not.toBeNull();
  });
  it("reads new linked drafts from their current path on every preview refresh", async () => {
    const entry = {
      ...picture("linked"),
      storage: "linked" as const,
      path: "D:/cover.png",
      picture: { source: "linked" as const, path: "D:/cover.png", pictureType: 3 },
    };
    const saved: number[][] = [];
    const paths: string[] = [];
    let bytes = [1, 2];
    const { root, props, calls } = mount(
      { mixed: false, picture: entry },
      undefined,
      async (data) => {
        saved.push(data);
      },
      false,
      async (path) => {
        paths.push(path);
        return bytes;
      },
    );
    await settle();
    await click(button(root));
    bytes = [3, 4];
    props.selection = { mixed: false, picture: { ...entry } };
    await settle();
    await click(button(root));
    expect(calls).toEqual([]);
    expect(paths).toEqual(["D:/cover.png", "D:/cover.png"]);
    expect(saved).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
  it("retains linked draft identity when path reading fails and disables only preview export", async () => {
    const entry = {
      ...picture("linked"),
      storage: "linked" as const,
      path: "D:/missing.png",
      error: "missing",
      picture: { source: "linked" as const, path: "D:/missing.png", pictureType: 3 },
    };
    const { root, props, calls } = mount(
      { mixed: false, picture: entry },
      undefined,
      undefined,
      false,
      async () => {
        throw new Error("missing path");
      },
    );
    await settle();
    expect(button(root).props.disabled).toBe(true);
    expect(getTextContent(root)).toContain("读取封面失败");
    expect(props.selection.picture?.picture).toEqual(entry.picture);
    expect(calls).toEqual([]);
  });
});
