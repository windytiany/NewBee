import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import type { ArtworkCollection, ArtworkPicture } from "@/features/artwork/collection/types";
import {
  addPicture,
  changePictureType,
  commonPictures,
  createCollectionDraft,
  deletePicture,
  displaySelection,
  setDisplayPicture,
} from "@/features/artwork/collection/model";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";
import { pictureTypeLabel, pictureTypes } from "@/features/artwork/collection/presentation";
import { setLocale } from "@/shared/i18n/locale";
const source = await Bun.file("src/features/artwork/collection/CollectionEditor.vue").text();
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  setLocale("zh-CN");
  for (const app of apps.splice(0)) app.unmount();
});
function picture(contentId: string, pictureType = 3): ArtworkPicture {
  return { contentId, pictureType, mimeType: "image/png", byteLength: 3, embedded: false };
}
function collection(
  trackId: number,
  pictures: ArtworkPicture[],
  displayIndex: number | null = pictures.length ? 0 : null,
): ArtworkCollection {
  return { trackId, pictures, displayIndex, error: null };
}
async function settle() {
  await Vue.nextTick();
  await Vue.nextTick();
  await Vue.nextTick();
}
function mount(collections: ArtworkCollection[], clipboard = async () => [9, 8]) {
  const draft = Vue.reactive(
    createCollectionDraft(
      collections.map((entry) => entry.trackId),
      collections,
    ),
  );
  const props = Vue.reactive({ disabled: false, importing: false, embedArtwork: false });
  const failures: unknown[] = [];
  const busy: boolean[] = [];
  const imports: Array<{ data: number[]; mime: string }> = [];
  const exports: string[] = [];
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "CollectionEditor.vue"),
    {
      vue: Vue,
      "@/features/artwork/collection/ArtworkPreview.vue": Vue.defineComponent({
        props: ["selection", "disabled"],
        setup:
          (props, { slots }) =>
          () =>
            Vue.h("preview", { picture: props.selection.picture?.key }, [
              Vue.h("image"),
              slots.details?.(),
              slots.actions?.({
                save: () => exports.push(props.selection.picture.key),
                disabled: props.disabled,
              }),
            ]),
      }),
      "@/features/artwork/transfer": {
        readClipboardCover: clipboard,
        pictureMimeType: async () => "image/png",
      },
    },
  ).default;
  const root = createHostNode("root");
  const app = createHostRenderer<HostNode>((type, text) => ({
    ...createHostNode(type, type === "#comment" ? "" : text),
    click: () => {},
  })).createApp({
    setup: () => () =>
      Vue.h(component, {
        ...props,
        draft,
        pictures: commonPictures(draft),
        display: displaySelection(draft),
        ready: draft.tracks.every((entry) => entry.error === null),
        addPicture: async (data: Uint8Array, mime: string, pictureType: number) => {
          imports.push({ data: Array.from(data), mime });
          return addPicture(
            draft,
            data,
            mime,
            async () => Uint8Array.from([1, 2, 3]).buffer,
            pictureType,
          );
        },
        onType: (key: string, type: number) => changePictureType(draft, key, type),
        onDelete: (key: string) => deletePicture(draft, key),
        onDisplay: (key: string) => setDisplayPicture(draft, key),
        onEmbed: (enabled: boolean) => {
          props.embedArtwork = enabled;
        },
        onFailed: (error: unknown) => failures.push(error),
        onBusy: (value: boolean) => busy.push(value),
      }),
  });
  app.mount(root);
  apps.push(app);
  return { root, draft, props, failures, busy, imports, exports, app };
}
function node(root: HostNode, predicate: (entry: HostNode) => boolean) {
  const result = findNode(root, predicate);
  if (!result) throw new Error("Missing collection control");
  return result;
}
function button(root: HostNode, label: string) {
  return node(root, (entry) => entry.type === "button" && getTextContent(entry) === label);
}
function click(entry: HostNode) {
  (entry.props.onClick as () => void)();
}
function select(
  root: HostNode,
  file: { size: number; type?: string; arrayBuffer: () => Promise<ArrayBuffer> } | null,
) {
  const target = { files: file ? [file] : [], value: "selected" };
  (
    node(root, (entry) => entry.props.type === "file").props.onChange as (event: {
      target: typeof target;
    }) => void
  )({ target });
  expect(target.value).toBe("");
}

describe("picture collection controls", () => {
  it("uses large separated picture rows with details and actions beside the preview", async () => {
    const { root, exports } = mount([collection(1, [picture("a"), picture("b")])]);
    const row = node(root, (entry) => entry.type === "li");
    expect(row.props.class).toContain("border-b");
    expect(row.props.class).not.toContain("rounded");
    const preview = node(row, (entry) => entry.type === "preview");
    expect(preview.props.class).toContain("11.5rem_minmax(0,1fr)_6.5rem");
    expect(findNode(preview, (entry) => entry.type === "select")).not.toBeNull();
    expect(findNode(preview, (entry) => entry.props.type === "radio")).not.toBeNull();
    expect(button(preview, "删除")).toBeDefined();
    click(button(preview, "保存封面"));
    expect(exports).toEqual(["a"]);
    expect(getTextContent(preview)).not.toContain("添加图片");
    expect(getTextContent(root)).not.toContain("评论");
    await settle();
  });
  it("uses the selected import type for file and clipboard additions", async () => {
    const { root, draft } = mount([collection(1, [])]);
    const type = node(root, (entry) => entry.type === "select");
    (type.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "4" },
    });
    click(button(root, "粘贴封面"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    expect(commonPictures(draft)[0]?.pictureType).toBe(4);
  });
  it("lists only common contents, shows mixed type and applies type/display/delete to all targets", async () => {
    const { root, draft } = mount([
      collection(1, [picture("a", 3), picture("private1", 4)]),
      collection(2, [picture("private2", 8), picture("a", 4)]),
    ]);
    expect(findNode(root, (entry) => entry.props.picture === "a")).not.toBeNull();
    expect(findNode(root, (entry) => entry.props.picture === "private1")).toBeNull();
    const type = node(root, (entry) => entry.type === "select");
    expect(type.props.value).toBe("");
    expect(getTextContent(type)).toContain("多个值");
    (type.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "20" },
    });
    await settle();
    expect(commonPictures(draft)[0]?.pictureType).toBe(20);
    const display = node(root, (entry) => entry.props.type === "radio");
    expect(display.props.checked).toBe(false);
    (display.props.onChange as () => void)();
    await settle();
    expect(draft.tracks.map((entry) => entry.displayKey)).toEqual(["a", "a"]);
    expect(display.props.checked).toBe(true);
    click(button(root, "删除"));
    await settle();
    expect(draft.tracks.map((entry) => entry.pictures.map((value) => value.key))).toEqual([
      ["private1"],
      ["private2"],
    ]);
    expect(draft.tracks.map((entry) => entry.displayKey)).toEqual(["private1", "private2"]);
    expect(getTextContent(root)).toContain("无共有图片");
    expect(getTextContent(root)).not.toContain("source");
  });
  it("keeps no-common and one-versus-none selections empty without previewing private pictures", () => {
    for (const collections of [
      [collection(1, [picture("a")]), collection(2, [picture("b")])],
      [collection(1, [picture("a")]), collection(2, [])],
    ]) {
      const { root, draft } = mount(collections);
      expect(displaySelection(draft).mixed).toBe(true);
      expect(findNode(root, (entry) => entry.type === "preview")).toBeNull();
      expect(getTextContent(root)).toContain("无共有图片");
    }
  });
  it("preserves unknown scanned types and provides all standard type labels", async () => {
    const { root, draft } = mount([collection(1, [picture("a", 255)])]);
    expect(draft.tracks[0]?.error).toBeNull();
    expect(getTextContent(root)).toContain("类型 255");
    expect(pictureTypes).toEqual(Array.from({ length: 21 }, (_, value) => value));
    for (const language of ["zh-CN", "en"] as const) {
      setLocale(language);
      await settle();
      for (const type of pictureTypes) expect(pictureTypeLabel(type)).not.toBe("");
    }
    expect(pictureTypeLabel(3, "ja")).toBe("表紙");
    expect(pictureTypeLabel(20, "ja")).toBe("出版社のロゴ");
  });
  it("imports clipboard bytes into every target without stealing the existing display", async () => {
    const { root, draft, imports, busy } = mount([
      collection(1, [picture("old")]),
      collection(2, []),
    ]);
    click(button(root, "粘贴封面"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    expect(imports).toEqual([{ data: [9, 8], mime: "image/png" }]);
    expect(busy).toEqual([true, false]);
    expect(draft.tracks.map((entry) => entry.pictures.length)).toEqual([2, 1]);
    expect(draft.tracks[0]?.displayKey).toBe("old");
    expect(draft.tracks[1]?.displayKey).not.toBeNull();
  });
  it("imports file and dropped bytes using detected MIME rather than the file MIME", async () => {
    const { root, imports } = mount([collection(1, [])]);
    const file = {
      size: 2,
      type: "text/html",
      arrayBuffer: async () => Uint8Array.from([9, 8]).buffer,
    };
    select(root, file);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    (root.children[0]?.props.onDrop as (event: object) => void)({
      preventDefault() {},
      dataTransfer: { files: [file] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    expect(imports).toEqual([
      { data: [9, 8], mime: "image/png" },
      { data: [9, 8], mime: "image/png" },
    ]);
  });
  it("toggles embedding without requiring picture edits", async () => {
    const { root, props, draft } = mount([collection(1, [picture("a")])]);
    const checkbox = node(root, (entry) => entry.props.type === "checkbox");
    expect(checkbox.props.checked).toBe(false);
    (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({
      target: { checked: true },
    });
    await settle();
    expect(props.embedArtwork).toBe(true);
    expect(checkbox.props.checked).toBe(true);
    expect(draft.tracks[0]?.pictures).toHaveLength(1);
  });
  it("shows collection load errors and blocks import and embedding", async () => {
    const failed = collection(1, []);
    failed.error = "failed";
    const { root, imports, props } = mount([failed]);
    expect(getTextContent(root)).toContain("图片集合加载失败");
    expect(button(root, "添加图片").props.disabled).toBe(true);
    click(button(root, "粘贴封面"));
    await settle();
    expect(imports).toEqual([]);
    expect(node(root, (entry) => entry.props.type === "checkbox").props.disabled).toBe(true);
    expect(props.embedArtwork).toBe(false);
  });
  for (const size of [0, 20 * 1024 * 1024 + 1]) {
    it(`rejects invalid file size ${size} before reading`, async () => {
      let reads = 0;
      const { root, imports, failures } = mount([collection(1, [])]);
      select(root, {
        size,
        arrayBuffer: async () => {
          reads++;
          return new ArrayBuffer(0);
        },
      });
      await settle();
      expect(reads).toBe(0);
      expect(imports).toEqual([]);
      expect(failures).toHaveLength(1);
    });
  }
  for (const change of ["disable", "unmount"] as const) {
    it(`ignores pending import after ${change}`, async () => {
      let resolve: (data: number[]) => void = () => {};
      const pending = new Promise<number[]>((yes) => {
        resolve = yes;
      });
      const { root, props, app, imports, busy } = mount([collection(1, [])], () => pending);
      click(button(root, "粘贴封面"));
      await settle();
      expect(button(root, "添加图片").props.disabled).toBe(true);
      if (change === "disable") props.disabled = true;
      else app.unmount();
      await settle();
      resolve([8]);
      await settle();
      expect(imports).toEqual([]);
      expect(busy[busy.length - 1]).toBe(false);
    });
  }
  it("reports clipboard read failures without changing pictures", async () => {
    const { root, failures, draft } = mount([collection(1, [])], async () => {
      throw new Error("clipboard failed");
    });
    click(button(root, "粘贴封面"));
    await settle();
    expect(String(failures[0])).toContain("clipboard failed");
    expect(draft.tracks[0]?.pictures).toEqual([]);
  });
});
