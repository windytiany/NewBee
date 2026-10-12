import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";

const source = await Bun.file("src/features/artwork/artist/PhotoEditor.vue").text();
const apps: Vue.App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});
interface PhotoNode extends HostNode {
  children: PhotoNode[];
  parent: PhotoNode | null;
  click: () => void;
  getBoundingClientRect: () => { left: number; bottom: number };
}
function createNode(type: string, text = ""): PhotoNode {
  return {
    ...createHostNode(type, text),
    children: [],
    parent: null,
    click() {},
    getBoundingClientRect: () => ({ left: 30, bottom: 90 }),
  };
}
function requiredNode(root: HostNode, predicate: (node: HostNode) => boolean) {
  const node = findNode(root, predicate);
  if (!node) throw new Error("Missing photo element");
  return node;
}
async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Vue.nextTick();
}
function mountEditor(
  initial: string | null = "Artist",
  options: Partial<{
    clipboard: () => Promise<number[]>;
    save: (artist: string, data: number[]) => Promise<void>;
    search: (artist: string) => Promise<void>;
  }> = {},
) {
  const props = Vue.reactive({ artist: initial });
  const saves: Array<{ artist: string; data: number[] }> = [];
  const refreshes: string[] = [];
  const searches: string[] = [];
  const failures: unknown[] = [];
  const request = Vue.shallowRef<unknown>(null);
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "PhotoEditor.vue"),
    {
      vue: Vue,
      "@/features/artwork/artist/ArtistPhoto.vue": Vue.defineComponent({
        props: ["artist"],
        setup: (props) => () => Vue.h("photo", { artist: props.artist }),
      }),
      "@/features/artwork/artist/api": {
        saveArtistPhoto: async (artist: string, data: number[]) => {
          saves.push({ artist, data });
          await options.save?.(artist, data);
        },
        searchArtistPhoto: async (artist: string) => {
          searches.push(artist);
          await options.search?.(artist);
        },
      },
      "@/features/artwork/artist/usePhoto": {
        refreshArtistPhoto: (artist: string) => refreshes.push(artist),
      },
      "@/features/artwork/transfer": {
        hasClipboardCover: async () => true,
        readClipboardCover: options.clipboard ?? (async () => [1, 2, 3]),
      },
      "@/shared/notifications/center": { notify: (value: unknown) => failures.push(value) },
      "@/shared/interaction/useContextMenu": {
        useContextMenu: () => ({
          request,
          position: Vue.ref({ x: 0, y: 0 }),
          open: (value: unknown) => {
            request.value = value;
          },
          close: () => {
            request.value = null;
          },
        }),
      },
    },
  ).default;
  const root = createNode("root");
  const app = createHostRenderer(createNode).createApp({
    setup: () => () => Vue.h(component, props),
  });
  app.mount(root);
  apps.push(app);
  const input = requiredNode(root, (node) => node.props.type === "file");
  function trigger() {
    return requiredNode(
      root,
      (node) => node.props["aria-label"] === "演出者照片" && node.props.role !== "menu",
    );
  }
  async function open() {
    (trigger().props.onContextmenu as (event: object) => void)({
      clientX: 10,
      clientY: 20,
      preventDefault() {},
      stopPropagation() {},
    });
    await settle();
  }
  function click(label: string) {
    const node = requiredNode(
      root,
      (node) => node.props.role === "menuitem" && getTextContent(node) === label,
    );
    (node.props.onClick as (event: object) => void)({ stopPropagation() {} });
  }
  async function choose(data: number[], size = data.length) {
    await open();
    click("选择照片");
    const target = {
      files: [{ size, arrayBuffer: async () => new Uint8Array(data).buffer }],
      value: "selected",
    };
    await (input.props.onChange as (event: object) => Promise<void>)({ target });
    expect(target.value).toBe("");
  }
  return { root, props, input, trigger, saves, refreshes, searches, failures, open, click, choose };
}

it("imports files and clipboard bytes and refreshes the shared photo only after successful save", async () => {
  const editor = mountEditor();
  await editor.choose([4, 5]);
  await editor.open();
  editor.click("粘贴照片");
  await settle();
  expect(editor.saves).toEqual([
    { artist: "Artist", data: [4, 5] },
    { artist: "Artist", data: [1, 2, 3] },
  ]);
  expect(editor.refreshes).toEqual(["Artist", "Artist"]);
  expect(editor.failures).toEqual([]);
});

it("opens manual Google search without importing or changing the current photo", async () => {
  const editor = mountEditor("Joy Division");
  await editor.open();
  editor.click("Google 图片搜索");
  await settle();
  expect(editor.searches).toEqual(["Joy Division"]);
  expect(editor.saves).toEqual([]);
  expect(editor.refreshes).toEqual([]);
  expect(findNode(editor.root, (node) => node.props.role === "menu")).toBeNull();
});

it("does not offer edits or network search for unknown artists", async () => {
  const editor = mountEditor(null);
  await editor.open();
  expect(findNode(editor.root, (node) => node.props.role === "menu")).toBeNull();
  expect(editor.input.props.disabled).toBe(true);
  expect(editor.saves).toEqual([]);
  expect(editor.searches).toEqual([]);
});

it("rejects empty and oversized files before reading or saving", async () => {
  const editor = mountEditor();
  await editor.choose([], 0);
  await editor.choose([1], 20 * 1024 * 1024 + 1);
  expect(editor.saves).toEqual([]);
  expect(editor.refreshes).toEqual([]);
  expect(editor.failures).toHaveLength(2);
});

it("reports failed saves without refreshing away the existing photo", async () => {
  const editor = mountEditor("Artist", {
    save: async () => {
      throw new Error("Disk full");
    },
  });
  await editor.choose([1]);
  expect(editor.saves).toEqual([{ artist: "Artist", data: [1] }]);
  expect(editor.refreshes).toEqual([]);
  expect(editor.failures).toHaveLength(1);
});

it("does not assign a delayed clipboard image to a newly selected artist", async () => {
  let resolve!: (data: number[]) => void;
  const editor = mountEditor("A", {
    clipboard: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  await editor.open();
  editor.click("粘贴照片");
  editor.props.artist = "B";
  await Vue.nextTick();
  resolve([1]);
  await settle();
  expect(editor.saves).toEqual([]);
  expect(editor.refreshes).toEqual([]);
});

it("cancels a file selection when the artist changes before the file returns", async () => {
  const editor = mountEditor("A");
  await editor.open();
  editor.click("选择照片");
  editor.props.artist = "B";
  await Vue.nextTick();
  await (editor.input.props.onChange as (event: object) => Promise<void>)({
    target: {
      files: [{ size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer }],
      value: "file",
    },
  });
  expect(editor.saves).toEqual([]);
});

it("offers the same menu from the keyboard and reports browser opening failures", async () => {
  const editor = mountEditor("Artist", {
    search: async () => {
      throw new Error("No browser");
    },
  });
  (editor.trigger().props.onKeydown as (event: object) => void)({
    key: "F10",
    shiftKey: true,
    preventDefault() {},
    stopPropagation() {},
  });
  await settle();
  editor.click("Google 图片搜索");
  await settle();
  expect(editor.searches).toEqual(["Artist"]);
  expect(editor.failures).toHaveLength(1);
});
