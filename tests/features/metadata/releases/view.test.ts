import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { setLocale } from "@/shared/i18n/locale";
import { compileSfc, evaluateSource } from "../../../support/module/loader";

import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";
import { createReleaseEditor } from "@/features/metadata/releases/useEditor";
import type { MappingDragOptions } from "@/features/metadata/releases/mapping/drag";
import * as metadata from "@/features/metadata/draft";
import { album, local, release } from "./fixtures";
const mappingSource = await Bun.file(
  "src/features/metadata/releases/components/TrackMapping.vue",
).text();
const searchSource = await Bun.file(
  "src/features/metadata/releases/components/ReleaseSearch.vue",
).text();
const fieldsSource = await Bun.file(
  "src/features/metadata/releases/components/TagFields.vue",
).text();
const menuSource = await Bun.file(
  "src/features/metadata/releases/components/ReleaseMenuItem.vue",
).text();
const dialogSource = await Bun.file(
  "src/features/metadata/releases/components/ReleaseTagDialog.vue",
).text();
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  setLocale("zh-CN");
  for (const app of apps.splice(0)) app.unmount();
});
const settle = async () => {
  for (let index = 0; index < 5; index++) await Vue.nextTick();
};
function fixture(synchronize: () => Promise<void> = async () => {}) {
  return createReleaseEditor({
    loadAlbum: async () => [local(1), local(2)],
    search: async () => ({ count: 0, offset: 0, releases: [] }),
    release: async () => release(),
    covers: async () => [],
    cover: async () => ({ mimeType: "image/png", data: [] }),
    save: async (patches) =>
      patches.map(({ trackId }) => ({
        trackId,
        path: `/music/${trackId}.flac`,
        fileWritten: true,
        databaseUpdated: true,
        error: null,
      })),
    synchronize,
    editFiles: (_ids, save) => save(),
  });
}
function node(root: HostNode, predicate: (node: HostNode) => boolean) {
  const found = findNode(root, predicate);
  if (!found) throw new Error("Missing view node");
  return found;
}
function event(entry: HostNode, name: string, value: object = {}) {
  (entry.props[name] as (event: object) => void)({
    preventDefault() {},
    stopPropagation() {},
    ...value,
  });
}
interface DialogNode extends HostNode {
  children: DialogNode[];
  parent: DialogNode | null;
  open: boolean;
  showModal: () => void;
  close: () => void;
}
function createDialogNode(type: string, text = ""): DialogNode {
  const node: DialogNode = {
    ...createHostNode(type, text),
    children: [],
    parent: null,
    open: false,
    showModal: () => {
      node.open = true;
    },
    close: () => {
      node.open = false;
    },
  };
  return node;
}

function mountDialog(editor: ReturnType<typeof createReleaseEditor>) {
  const passive = Vue.defineComponent({ setup: () => () => null });
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(dialogSource, "ReleaseTagDialog.vue"),
    {
      vue: Vue,
      "@/features/metadata/releases/useEditor": { useReleaseEditor: () => editor },
      "@/features/metadata/draft": metadata,
      "@/features/metadata/releases/components/ReleaseSearch.vue": passive,
      "@/features/metadata/releases/components/TagFields.vue": passive,
      "@/features/metadata/releases/components/TrackMapping.vue": passive,
    },
  ).default;
  const root = createDialogNode("root");
  const app = createHostRenderer(createDialogNode).createApp(component);
  app.mount(root);
  apps.push(app);
  return root;
}

describe("album tag views", () => {
  it("translates pending field names and dynamic confirmation counts reactively", async () => {
    const editor = fixture();
    const root = mountDialog(editor);
    await editor.open(album);
    editor.selectRelease(release().summary.id);
    await settle();
    editor.setValue(0, "title", "新标题");
    editor.setSharedValue("albumArtist", "新艺术家");
    editor.prepareSave();
    await settle();
    expect(getTextContent(root)).toContain("2 首");
    expect(getTextContent(root)).toContain("标题");
    setLocale("en");
    await settle();
    expect(getTextContent(root)).toContain("2 tracks");
    expect(getTextContent(root)).toContain("Title");
    expect(getTextContent(root)).toContain("Album artist");
    expect(getTextContent(root)).toContain("Confirm write");
    expect(
      findNode(root, (entry) => entry.props["aria-label"] === "Confirm tag overwrite"),
    ).not.toBeNull();
    setLocale("zh-CN");
    await settle();
    expect(getTextContent(root)).toContain("标题");
    expect(getTextContent(root)).toContain("确认写入");
  });
  it("updates cover empty states and field accessibility labels while keeping release data intact", async () => {
    const editor = fixture();
    await editor.open(album);
    editor.selectRelease(release().summary.id);
    await settle();
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(fieldsSource, "TagFields.vue"),
      { vue: Vue, "@/features/metadata/draft": metadata },
    ).default;
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp(component, {
      editor,
      disabled: false,
    });
    app.mount(root);
    apps.push(app);
    expect(getTextContent(root)).toContain("暂无封面");
    const input = node(root, (entry) => entry.props.id === "album-tag-album");
    const originalValue = input.props.value;
    setLocale("en");
    await settle();
    expect(getTextContent(root)).toContain("No cover");
    expect(
      findNode(root, (entry) => entry.props["aria-label"] === "Overwrite Album"),
    ).not.toBeNull();
    expect(String(input.props.title)).toStartWith("Original: ");
    expect(input.props.value).toBe(originalValue);
    setLocale("zh-CN");
    await settle();
    expect(getTextContent(root)).toContain("暂无封面");
    expect(findNode(root, (entry) => entry.props["aria-label"] === "覆盖专辑")).not.toBeNull();
    expect(input.props.value).toBe(originalValue);
  });
  it("hides result details and retry controls while retaining successful save results", async () => {
    let refreshes = 0;
    const editor = fixture(async () => {
      refreshes++;
      if (refreshes === 1) throw new Error("reload failed");
    });
    const root = mountDialog(editor);
    await editor.open(album);
    editor.selectRelease(release().summary.id);
    await settle();
    editor.prepareSave();
    await editor.save();
    await settle();
    expect(getTextContent(root)).not.toContain("reload failed");
    expect(getTextContent(root)).not.toContain("重试");
    expect(getTextContent(root)).not.toContain("保存成功");
    expect(findNode(root, (entry) => entry.props["aria-label"] === "逐曲保存结果")).toBeNull();
    expect(refreshes).toBe(1);
    expect(editor.state.results.every(({ databaseUpdated }) => databaseUpdated)).toBe(true);
    expect(editor.state.synchronizationError).toContain("reload failed");
    expect(editor.state.open).toBe(true);
  });

  it("wires album context-menu selection to the album editor", async () => {
    const editor = fixture();
    let closed = 0;
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(menuSource, "ReleaseMenuItem.vue"),
      {
        vue: Vue,
        "@/features/metadata/releases/useEditor": { useReleaseEditor: () => editor },
      },
    ).default;
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp(component, {
      album,
      onClose: () => {
        closed++;
      },
    });
    app.mount(root);
    apps.push(app);
    const button = node(root, (entry) => entry.props.role === "menuitem");
    expect(getTextContent(button).trim()).toBe("根据专辑更新标签");
    event(button, "onClick");
    await settle();
    expect(closed).toBe(1);
    expect(editor.state.open).toBe(true);
    expect(editor.state.tracks.length).toBe(2);
  });
  it("drags local files to swap source slots and allows keyboard-selectable empty slots", async () => {
    const editor = fixture();
    await editor.open(album);
    editor.selectRelease(release().summary.id);
    await settle();
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(mappingSource, "TrackMapping.vue"),
      {
        vue: Vue,
        "@/features/metadata/draft": metadata,
        "@/features/library/format": { formatTrackDuration: () => "3:00" },
        "@/features/metadata/releases/mapping/drag": {
          createMappingDrag: (options: MappingDragOptions) => ({
            start: (id: number) => {
              if (options.canStart()) options.drop(id, 1);
            },
            cancel: () => {},
            suppressClick: () => {},
          }),
        },
      },
    ).default;
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp(component, {
      editor,
      disabled: false,
    });
    app.mount(root);
    apps.push(app);
    expect(
      findNode(root, (entry) => entry.props["data-album-tag-slot"] === "unmatched"),
    ).toBeNull();
    expect(getTextContent(root)).not.toContain("橙色表示");
    const draggable = node(root, (entry) => entry.props["data-local-track-id"] === 1);
    expect(draggable.type).toBe("tr");
    event(draggable, "onPointerdown", { target: { closest: () => ({}) } });
    expect(editor.state.rows.map((row) => row.trackId)).toEqual([1, 2, null, null]);
    event(draggable, "onPointerdown", { target: { closest: () => null } });
    await settle();
    expect(editor.state.rows.map((row) => row.trackId)).toEqual([2, 1, null, null]);
    const thirdRow = node(root, (entry) => entry.props["data-album-tag-slot"] === 2);
    const thirdDisclosure = node(thirdRow, (entry) =>
      String(entry.props["aria-label"] ?? "").startsWith("查看差异"),
    );
    event(thirdDisclosure, "onClick");
    await settle();
    const thirdSelect = node(
      root,
      (entry) => entry.props["aria-label"] === "第 2 碟第 1 首对应文件",
    );
    event(thirdSelect, "onChange", { target: { value: "1" } });
    await settle();
    expect(editor.state.rows.map((row) => row.trackId)).toEqual([2, null, 1, null]);
    event(thirdSelect, "onChange", { target: { value: "" } });
    await settle();
    expect(editor.state.rows[2]?.trackId).toBeNull();
    expect(getTextContent(root)).not.toContain("未匹配");
    const detached = node(
      root,
      (entry) => entry.type === "tr" && entry.props["data-local-track-id"] === 1,
    );
    expect(
      detached.children
        .filter((entry) => entry.type === "td")
        .slice(0, 5)
        .every(
          (entry) =>
            entry.text.trim() === "" &&
            entry.children
              .filter((child) => child.type !== "#comment")
              .every((child) => getTextContent(child).trim() === ""),
        ),
    ).toBe(true);
    expect(getTextContent(detached)).toContain("Song 1");
    expect(findNode(detached, (entry) => entry.type === "input")).toBeNull();
    const disclosure = node(root, (entry) =>
      String(entry.props["aria-label"] ?? "").startsWith("查看差异"),
    );
    event(disclosure, "onClick");
    await settle();
    const selectedLocal = editor.state.tracks.find(
      ({ track }) => track.id === editor.state.rows[0]?.trackId,
    );
    if (!selectedLocal) throw new Error("Missing selected local track");
    selectedLocal.issue = "track issue details";
    selectedLocal.writableFields = [];
    await settle();
    expect(getTextContent(root)).not.toContain("track issue details");
    expect(getTextContent(root)).not.toContain("不支持写入");
    expect(getTextContent(root)).toContain("原值：");
    const titleInput = node(root, (entry) => entry.props.id === "match-0-title");
    event(titleInput, "onInput", { target: { value: "手动修订" } });
    expect(editor.state.rows[0]?.values.title).toBe("手动修订");
  });
  it("selects a release directly from the result row without writing files", async () => {
    const editor = fixture();
    await editor.open(album);
    editor.state.candidates = [release().summary];
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(searchSource, "ReleaseSearch.vue"),
      { vue: { ...Vue, vModelText: {} } },
    ).default;
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp(component, {
      editor,
      disabled: false,
    });
    app.mount(root);
    apps.push(app);
    expect(getTextContent(root)).not.toContain("点击“查找”");
    const row = node(
      root,
      (entry) => entry.type === "tr" && entry.props["aria-selected"] === false,
    );
    event(row, "onClick");
    await settle();
    expect(editor.state.selected?.summary.id).toBe(release().summary.id);
    expect(row.props["aria-selected"]).toBe(true);
    expect(editor.state.confirmSave).toBe(false);
    expect(editor.state.results).toEqual([]);
  });
  it("scrolls search results by exactly one row regardless of wheel delta", async () => {
    const editor = fixture();
    await editor.open(album);
    editor.state.candidates = Array.from(
      { length: 20 },
      (_, index) => release(String(index)).summary,
    );
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(searchSource, "ReleaseSearch.vue"),
      { vue: { ...Vue, vModelText: {} } },
    ).default;
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp(component, {
      editor,
      disabled: false,
    });
    app.mount(root);
    apps.push(app);
    const scroll = node(root, (entry) => entry.props.onWheel !== undefined);
    const viewport = {
      scrollTop: 0,
      scrollHeight: 584,
      clientHeight: 164,
      querySelector: () => ({ getBoundingClientRect: () => ({ height: 28 }) }),
    };
    let prevented = 0;
    const wheel = (deltaY: number, extra = {}) =>
      event(scroll, "onWheel", {
        currentTarget: viewport,
        deltaY,
        preventDefault: () => {
          prevented++;
        },
        ...extra,
      });
    wheel(120);
    expect(viewport.scrollTop).toBe(28);
    wheel(600);
    expect(viewport.scrollTop).toBe(56);
    wheel(-300);
    expect(viewport.scrollTop).toBe(28);
    wheel(0);
    wheel(120, { ctrlKey: true });
    expect(viewport.scrollTop).toBe(28);
    expect(prevented).toBe(3);
    viewport.scrollTop = 13;
    wheel(1);
    expect(viewport.scrollTop).toBe(28);
    viewport.scrollTop = 420;
    wheel(120);
    expect(viewport.scrollTop).toBe(420);
    viewport.scrollTop = 0;
    wheel(-120);
    expect(viewport.scrollTop).toBe(0);
    expect(editor.state.selected).toBeNull();
  });
  it("keeps each shared field checkbox beside its value and preserves unchecked fields", async () => {
    const editor = fixture();
    await editor.open(album);
    editor.selectRelease(release().summary.id);
    await settle();
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(fieldsSource, "TagFields.vue"),
      { vue: Vue, "@/features/metadata/draft": metadata },
    ).default;
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp(component, {
      editor,
      disabled: false,
    });
    app.mount(root);
    apps.push(app);
    editor.state.coverError = "cover failed details";
    await settle();
    expect(getTextContent(root)).not.toContain("cover failed details");
    expect(getTextContent(root)).not.toContain("重试封面");
    expect(getTextContent(root)).not.toContain("勾选的字段才会写入");
    const checkbox = node(root, (entry) => entry.props["aria-label"] === "覆盖专辑");
    const input = node(root, (entry) => entry.props.id === "album-tag-album");
    event(input, "onInput", { target: { value: "新专辑" } });
    expect(editor.state.rows.every((row) => row.values.album === "新专辑")).toBe(true);
    event(checkbox, "onChange");
    await settle();
    expect(input.props.disabled).toBe(true);
    editor.prepareSave();
    expect(
      editor.state.patches.every((patch) =>
        patch.changes.every((change) => change.field !== "album"),
      ),
    ).toBe(true);
  });
  it("selects all mapped tracks and shifts the selected local file without changing source order", async () => {
    const editor = fixture();
    await editor.open(album);
    editor.selectRelease(release().summary.id);
    await settle();
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(mappingSource, "TrackMapping.vue"),
      {
        vue: Vue,
        "@/features/metadata/draft": metadata,
        "@/features/library/format": { formatTrackDuration: () => "3:00" },
        "@/features/metadata/releases/mapping/drag": {
          createMappingDrag: () => ({ start() {}, cancel() {}, suppressClick() {} }),
        },
      },
    ).default;
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp(component, {
      editor,
      disabled: false,
    });
    app.mount(root);
    apps.push(app);
    const scroll = node(root, (entry) => entry.props["data-album-tag-scroll"] !== undefined);
    expect(String(scroll.props.class)).toContain("max-h-[min(240px,36dvh)]");
    expect(String(scroll.props.class)).not.toContain("flex-1");
    const all = node(root, (entry) => entry.props["aria-label"] === "选择全部对应曲目");
    event(all, "onChange");
    await settle();
    expect(editor.state.included).toEqual([]);
    event(all, "onChange");
    await settle();
    expect(editor.state.included).toEqual([1, 2]);
    const sourceTitles = editor.state.rows.map((row) => row.source?.title);
    const localFile = node(root, (entry) => entry.props["data-local-track-id"] === 1);
    event(localFile, "onClick");
    await settle();
    const down = node(root, (entry) => entry.props["aria-label"] === "下移本地曲目");
    expect(down.props.disabled).toBe(false);
    event(down, "onClick");
    await settle();
    expect(editor.state.rows.map((row) => row.trackId)).toEqual([2, 1, null, null]);
    expect(editor.state.rows.map((row) => row.source?.title)).toEqual(sourceTitles);
    expect(getTextContent(root)).toContain("原始标题");
  });
  it("uses native modal dialogs, requires save confirmation and handles discard", async () => {
    const editor = fixture();
    const root = mountDialog(editor);
    await editor.open(album);
    editor.selectRelease(release().summary.id);
    await settle();
    const main = node(
      root,
      (entry) => entry.props["aria-labelledby"] === "album-tags-title",
    ) as DialogNode;
    expect(main.open).toBe(true);
    expect(String(main.props.class)).toContain("h-fit");
    expect(findNode(root, (entry) => entry.props["aria-label"] === "关闭标签更新窗口")).toBeNull();
    expect(
      findNode(main, (entry) => entry.type === "button" && getTextContent(entry).trim() === "取消"),
    ).not.toBeNull();
    const save = node(
      root,
      (entry) => entry.type === "button" && getTextContent(entry).trim() === "应用",
    );
    event(save, "onClick");
    await settle();
    expect(getTextContent(root)).toContain("确认写入");
    expect(getTextContent(root)).not.toContain("保存后不可撤销");
    expect(editor.state.confirmSave).toBe(true);
    editor.state.confirmSave = false;
    editor.move(1, 2);
    event(main, "onCancel");
    await settle();
    const discard = node(
      root,
      (entry) => entry.props["aria-labelledby"] === "album-tags-discard-title",
    ) as DialogNode;
    expect(discard.open).toBe(true);
    expect(getTextContent(discard)).not.toContain("未保存的字段");
    editor.confirmDiscard();
    await settle();
    expect(main.open).toBe(false);
  });
});
