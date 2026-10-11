import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as Vue from "vue";
import type { CoverEdit } from "@/features/tags/types";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";

const source = await Bun.file("src/features/tags/manual/components/TagCoverEditor.vue").text();
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});
interface CoverNode extends HostNode {
  children: CoverNode[];
  parent: CoverNode | null;
  clicks: number;
  click: () => void;
  getBoundingClientRect: () => { left: number; bottom: number };
}
function createNode(type: string, text = ""): CoverNode {
  const node: CoverNode = {
    ...createHostNode(type, type === "#comment" ? "" : text),
    children: [],
    parent: null,
    clicks: 0,
    click: () => node.clicks++,
    getBoundingClientRect: () => ({ left: 30, bottom: 90 }),
  };
  return node;
}
function requiredNode(root: HostNode, predicate: (node: HostNode) => boolean) {
  const node = findNode(root, predicate);
  if (!node) throw new Error("Missing cover editor element");
  return node;
}
function mountEditor(
  initial: CoverEdit | null = null,
  disabled = false,
  trackId: number | null = 1,
  transfer: Partial<{
    hasClipboardCover: () => Promise<boolean>;
    readClipboardCover: () => Promise<number[]>;
    readOriginalCover: (trackId: number) => Promise<number[]>;
    saveCover: (data: number[], isCurrent: () => boolean) => Promise<void>;
  }> = {},
  artworkStatus: "loading" | "ready" | "fallback" = "ready",
) {
  const props = Vue.reactive({ cover: initial, disabled, trackId });
  const changes: CoverEdit[] = [];
  const failures: unknown[] = [];
  const request = Vue.shallowRef<unknown>(null);
  const position = Vue.ref({ x: 0, y: 0 });
  const closed: boolean[] = [];
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "TagCoverEditor.vue"),
    {
      vue: Vue,
      "@/features/artwork/transfer": {
        hasClipboardCover: async () => false,
        readClipboardCover: async () => [],
        readOriginalCover: async () => [],
        saveCover: async () => {},
        ...transfer,
      },
      "@/features/artwork/components/TrackArtwork.vue": Vue.defineComponent({
        props: ["trackId"],
        emits: ["status"],
        setup: (artworkProps, { slots, emit }) => {
          emit("status", artworkStatus);
          return () => Vue.h("artwork", { trackId: artworkProps.trackId }, slots.default?.());
        },
      }),
      "@/shared/interaction/useContextMenu": {
        useContextMenu: () => ({
          request,
          position,
          open: (value: { x: number; y: number }) => {
            request.value = value;
            position.value = { x: value.x, y: value.y };
          },
          close: (restoreFocus = false) => {
            closed.push(restoreFocus);
            request.value = null;
          },
        }),
      },
    },
  ).default;
  const root = createNode("dialog");
  const app = createHostRenderer(createNode).createApp({
    setup: () => () =>
      Vue.h(component, {
        ...props,
        class: "size-36",
        onChange: (cover: CoverEdit) => {
          changes.push(cover);
          props.cover = cover;
        },
        onFailed: (error: unknown) => failures.push(error),
      }),
  });
  app.mount(root);
  apps.push(app);
  const trigger = requiredNode(root, (node) => node.props.role === "button");
  const input = requiredNode(root, (node) => node.props.type === "file");
  function open() {
    (trigger.props.onContextmenu as (event: object) => void)({
      clientX: 40,
      clientY: 60,
      preventDefault() {},
      stopPropagation() {},
    });
  }
  function select(file: { size: number; arrayBuffer: () => Promise<ArrayBuffer> } | null) {
    const target = { files: file ? [file] : [], value: "selected" };
    const result = (input.props.onChange as (event: { target: typeof target }) => Promise<void>)({
      target,
    });
    expect(target.value).toBe("");
    return result;
  }
  return {
    app,
    root,
    props,
    changes,
    failures,
    trigger,
    input,
    open,
    select,
    request,
    position,
    closed,
  };
}
function menuButton(root: HostNode, label: string) {
  return requiredNode(
    root,
    (node) => node.props.role === "menuitem" && getTextContent(node).trim() === label,
  );
}
function click(node: HostNode) {
  (node.props.onClick as (event: { stopPropagation: () => void }) => void)({
    stopPropagation() {},
  });
}
function file(data = [1, 2, 3]) {
  return { size: data.length, arrayBuffer: async () => new Uint8Array(data).buffer };
}
function deferredFile() {
  let resolve: (value: ArrayBuffer) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<ArrayBuffer>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { size: 3, arrayBuffer: () => promise, resolve, reject };
}

describe("tag cover editor", () => {
  it("shows original artwork at caller size and keeps its menu inside the dialog", async () => {
    const { root, open, position } = mountEditor();
    expect(findNode(root, (node) => node.type === "artwork")?.props.trackId).toBe(1);
    expect(root.children[0]?.props.class).toContain("size-36");
    expect(findNode(root, (node) => node.props.role === "menu")).toBeNull();
    expect(getTextContent(root)).toBe("");
    open();
    await Vue.nextTick();
    const menu = requiredNode(root, (node) => node.props.role === "menu");
    expect(menu.parent).toBe(root.children[0] ?? null);
    expect(position.value).toEqual({ x: 40, y: 60 });
    expect(getTextContent(menu)).toContain("替换封面");
    expect(getTextContent(menu)).toContain("移除封面");
  });

  it("disables paste and export when no image is available", async () => {
    const { root, open } = mountEditor();
    open();
    await Vue.nextTick();
    expect(menuButton(root, "粘贴封面").props.disabled).toBe(true);
    expect(menuButton(root, "保存封面").props.disabled).toBe(true);
  });

  it("checks each menu opening and rereads the clipboard on paste", async () => {
    let available = false;
    let checks = 0;
    let reads = 0;
    const { root, open, request, changes } = mountEditor(null, false, 1, {
      hasClipboardCover: async () => {
        checks++;
        return available;
      },
      readClipboardCover: async () => {
        reads++;
        return [9, 8];
      },
    });
    open();
    await Vue.nextTick();
    expect(menuButton(root, "粘贴封面").props.disabled).toBe(true);
    request.value = null;
    available = true;
    open();
    await Vue.nextTick();
    await Vue.nextTick();
    expect(menuButton(root, "粘贴封面").props.disabled).toBe(false);
    click(menuButton(root, "粘贴封面"));
    await Vue.nextTick();
    expect(checks).toBe(2);
    expect(reads).toBe(1);
    expect(changes).toEqual([{ action: "replace", data: [9, 8] }]);
    await Vue.nextTick();
    expect(findNode(root, (node) => node.type === "img")?.props.src).toMatch(/^blob:/);
  });

  it("reports a changed or unreadable clipboard without changing the cover", async () => {
    for (const readClipboardCover of [
      async () => [],
      async () => {
        throw new Error("clipboard locked");
      },
    ]) {
      const { root, open, changes, failures } = mountEditor(null, false, 1, {
        hasClipboardCover: async () => true,
        readClipboardCover,
      });
      open();
      await Vue.nextTick();
      click(menuButton(root, "粘贴封面"));
      await Vue.nextTick();
      expect(changes).toEqual([]);
      expect(failures).toHaveLength(1);
    }
  });

  it("exports original bytes or the unsaved preview without editing tags", async () => {
    for (const cover of [
      null,
      { action: "replace", data: [4, 5] },
    ] satisfies Array<CoverEdit | null>) {
      const saved: number[][] = [];
      const loaded: number[] = [];
      const { root, open, changes } = mountEditor(cover, false, 7, {
        readOriginalCover: async (trackId) => {
          loaded.push(trackId);
          return [1, 2, 3];
        },
        saveCover: async (data, isCurrent) => {
          expect(isCurrent()).toBe(true);
          saved.push(data);
        },
      });
      open();
      await Vue.nextTick();
      await Vue.nextTick();
      expect(menuButton(root, "保存封面").props.disabled).toBe(false);
      click(menuButton(root, "保存封面"));
      await Vue.nextTick();
      expect(saved).toEqual([cover?.action === "replace" ? [4, 5] : [1, 2, 3]]);
      expect(loaded).toEqual(cover === null ? [7] : []);
      expect(changes).toEqual([]);
    }
  });

  for (const status of ["loading", "fallback"] as const) {
    it(`disables export while the original image is ${status}`, async () => {
      const { root, open } = mountEditor(
        null,
        false,
        1,
        { readOriginalCover: async () => [1] },
        status,
      );
      open();
      await Vue.nextTick();
      await Vue.nextTick();
      expect(menuButton(root, "保存封面").props.disabled).toBe(true);
    });
  }

  it("disables export after removal even with an original track", async () => {
    const { root, open } = mountEditor({ action: "delete" }, false, 1, {
      readOriginalCover: async () => [1],
    });
    open();
    await Vue.nextTick();
    expect(menuButton(root, "保存封面").props.disabled).toBe(true);
  });

  it("reports export failures without changing the preview", async () => {
    const error = new Error("write failed");
    const { root, open, failures, changes } = mountEditor(
      { action: "replace", data: [4] },
      false,
      null,
      {
        saveCover: async () => {
          throw error;
        },
      },
    );
    open();
    await Vue.nextTick();
    click(menuButton(root, "保存封面"));
    await Vue.nextTick();
    expect(failures).toEqual([error]);
    expect(changes).toEqual([]);
    expect(findNode(root, (node) => node.type === "img")).not.toBeNull();
  });

  for (const change of ["track", "cover", "disabled", "unmount"] as const) {
    it(`ignores pending clipboard data after ${change}`, async () => {
      let resolve: (data: number[]) => void = () => {};
      const pending = new Promise<number[]>((done) => {
        resolve = done;
      });
      const { root, open, props, app, changes, failures } = mountEditor(null, false, 1, {
        hasClipboardCover: async () => true,
        readClipboardCover: () => pending,
      });
      open();
      await Vue.nextTick();
      click(menuButton(root, "粘贴封面"));
      if (change === "track") props.trackId = 2;
      else if (change === "cover") props.cover = { action: "delete" };
      else if (change === "disabled") props.disabled = true;
      else app.unmount();
      resolve([8]);
      await Vue.nextTick();
      expect(changes).toEqual([]);
      expect(failures).toEqual([]);
    });
  }

  it("ignores menu checks after close or a later opening", async () => {
    let resolve: (available: boolean) => void = () => {};
    let checks = 0;
    const pending = new Promise<boolean>((done) => {
      resolve = done;
    });
    const { root, open, request } = mountEditor(null, false, 1, {
      hasClipboardCover: () => (++checks === 1 ? pending : Promise.resolve(false)),
    });
    open();
    request.value = null;
    open();
    await Vue.nextTick();
    resolve(true);
    await Vue.nextTick();
    expect(menuButton(root, "粘贴封面").props.disabled).toBe(true);
  });

  it("opens the image picker from the menu and applies replacement data with a preview", async () => {
    const { root, open, input, select, changes, closed } = mountEditor();
    expect(input.props.accept).toBe("image/*");
    expect(input.props.hidden).toBeDefined();
    open();
    await Vue.nextTick();
    click(menuButton(root, "替换封面"));
    expect((input as CoverNode).clicks).toBe(1);
    expect(closed).toContain(true);
    await select(file());
    await Vue.nextTick();
    expect(changes).toEqual([{ action: "replace", data: [1, 2, 3] }]);
    expect(findNode(root, (node) => node.type === "img")?.props.src).toMatch(/^blob:/);
    expect(findNode(root, (node) => node.type === "artwork")).toBeNull();
    expect(getTextContent(root)).toBe("");
  });

  it("removes the cover and shows a placeholder even when the original artwork exists", async () => {
    const { root, open, changes } = mountEditor();
    open();
    await Vue.nextTick();
    click(menuButton(root, "移除封面"));
    await Vue.nextTick();
    expect(changes).toEqual([{ action: "delete" }]);
    expect(findNode(root, (node) => node.type === "artwork")).toBeNull();
    expect(findNode(root, (node) => node.type === "img")).toBeNull();
    expect(findNode(root, (node) => node.props.role === "menu")).toBeNull();
    expect(getTextContent(root)).toBe("");
  });

  it("shows a placeholder for multiple tracks", () => {
    const { root } = mountEditor(null, false, null);
    expect(findNode(root, (node) => node.type === "artwork")).toBeNull();
    expect(findNode(root, (node) => node.type === "img")).toBeNull();
  });

  it("releases preview URLs when replaced, removed and unmounted", async () => {
    const revoke = spyOn(URL, "revokeObjectURL");
    try {
      const { root, props, app } = mountEditor({ action: "replace", data: [1] });
      const first = requiredNode(root, (node) => node.type === "img").props.src;
      props.cover = { action: "replace", data: [2] };
      await Vue.nextTick();
      expect(revoke).toHaveBeenCalledWith(first);
      const second = requiredNode(root, (node) => node.type === "img").props.src;
      props.cover = { action: "delete" };
      await Vue.nextTick();
      expect(revoke).toHaveBeenCalledWith(second);
      props.cover = { action: "replace", data: [3] };
      await Vue.nextTick();
      const third = requiredNode(root, (node) => node.type === "img").props.src;
      app.unmount();
      expect(revoke).toHaveBeenCalledWith(third);
    } finally {
      revoke.mockRestore();
    }
  });

  for (const event of [
    { key: "ContextMenu", shiftKey: false },
    { key: "F10", shiftKey: true },
  ]) {
    it(`opens at the artwork bounds using ${event.key}`, async () => {
      const { trigger, root, position } = mountEditor();
      let prevented = false;
      (trigger.props.onKeydown as (event: object) => void)({
        ...event,
        preventDefault: () => {
          prevented = true;
        },
      });
      await Vue.nextTick();
      expect(prevented).toBe(true);
      expect(position.value).toEqual({ x: 30, y: 90 });
      expect(findNode(root, (node) => node.props.role === "menu")).not.toBeNull();
    });
  }

  it("disables right-click, keyboard menus and file selection", async () => {
    const { root, trigger, input, open, select, changes, failures } = mountEditor(null, true);
    expect(input.props.disabled).toBe(true);
    expect(trigger.props.tabindex).toBe(-1);
    open();
    (trigger.props.onKeydown as (event: object) => void)({
      key: "ContextMenu",
      preventDefault() {},
    });
    await select(file());
    await Vue.nextTick();
    expect(findNode(root, (node) => node.props.role === "menu")).toBeNull();
    expect(changes).toEqual([]);
    expect(failures).toEqual([]);
  });

  for (const size of [0, 20 * 1024 * 1024 + 1]) {
    it(`rejects invalid cover size ${size}`, async () => {
      const { select, failures, changes } = mountEditor();
      let reads = 0;
      await select({
        size,
        arrayBuffer: async () => {
          reads++;
          return new ArrayBuffer(0);
        },
      });
      expect(reads).toBe(0);
      expect(failures).toHaveLength(1);
      expect(String(failures[0])).toContain("封面为空或超过 20 MiB。");
      expect(changes).toEqual([]);
    });
  }

  it("accepts the size limit, ignores cancellation and reports read errors", async () => {
    const { select, failures, changes } = mountEditor();
    await select(null);
    await select({ ...file(), size: 20 * 1024 * 1024 });
    const error = new Error("read failed");
    await select({
      size: 1,
      arrayBuffer: async () => {
        throw error;
      },
    });
    expect(changes).toHaveLength(1);
    expect(failures).toEqual([error]);
  });

  for (const change of ["track", "cover", "disabled", "unmount"] as const) {
    for (const failure of [false, true]) {
      it(`ignores pending ${failure ? "errors" : "results"} after ${change} changes and closes the menu`, async () => {
        const { props, app, open, request, select, changes, failures } = mountEditor();
        const pending = deferredFile();
        const reading = select(pending);
        open();
        if (change === "track") props.trackId = 2;
        else if (change === "cover") props.cover = { action: "delete" };
        else if (change === "disabled") props.disabled = true;
        else app.unmount();
        await Vue.nextTick();
        if (change !== "unmount") expect(request.value).toBeNull();
        if (failure) pending.reject(new Error("obsolete read"));
        else pending.resolve(new Uint8Array([4]).buffer);
        await reading;
        expect(changes).toEqual([]);
        expect(failures).toEqual([]);
      });
    }
  }

  it("ignores an earlier selection when a later selection finishes first", async () => {
    const { select, changes } = mountEditor();
    const pending = deferredFile();
    const reading = select(pending);
    await select(file([9]));
    pending.resolve(new Uint8Array([1]).buffer);
    await reading;
    expect(changes).toEqual([{ action: "replace", data: [9] }]);
  });
});
