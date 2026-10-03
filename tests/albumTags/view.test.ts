import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "../support/moduleLoader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../support/hostRenderer";
import type { HostNode } from "../support/hostRenderer";
import { createAlbumTagEditor } from "@/albumTags/editor";
import type { MappingDragOptions } from "@/albumTags/dragMapping";
import * as metadata from "@/metadata/model";
import { album, local, release } from "./fixtures";
const mappingSource = await Bun.file("src/albumTags/ui/TrackMapping.vue").text();
const menuSource = await Bun.file("src/albumTags/ui/AlbumTagMenuItem.vue").text();
const dialogSource = await Bun.file("src/albumTags/ui/AlbumTagDialog.vue").text();
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});
const settle = async () => {
  for (let index = 0; index < 5; index++) await Vue.nextTick();
};
function fixture() {
  return createAlbumTagEditor({
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
    synchronize: async () => {},
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

describe("album tag views", () => {
  it("wires album context-menu selection to the album editor", async () => {
    const editor = fixture();
    let closed = 0;
    const component = evaluateModule<{ default: Vue.Component }>(
      compileSfc(menuSource, "AlbumTagMenuItem.vue"),
      {
        vue: Vue,
        "@/albumTags/editor": { useAlbumTagEditor: () => editor },
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
    const component = evaluateModule<{ default: Vue.Component }>(
      compileSfc(mappingSource, "TrackMapping.vue"),
      {
        vue: Vue,
        "@/metadata/model": metadata,
        "@/library/formatTrack": { formatTrackDuration: () => "3:00" },
        "@/albumTags/dragMapping": {
          createMappingDrag: (options: MappingDragOptions) => ({
            start: (id: number) => {
              if (options.canStart()) options.drop(id, 1);
            },
            cancel: () => {},
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
    const draggable = node(root, (entry) => entry.props["data-local-track-id"] === 1);
    event(draggable, "onPointerdown");
    await settle();
    expect(editor.state.rows.map((row) => row.trackId)).toEqual([2, 1, null, null]);
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
    expect(getTextContent(root)).toContain("未匹配本地曲目（1）");
    const disclosure = node(
      root,
      (entry) => entry.type === "button" && getTextContent(entry).includes("查看差异"),
    );
    event(disclosure, "onClick");
    await settle();
    const titleInput = node(root, (entry) => entry.props.id === "match-0-title");
    event(titleInput, "onInput", { target: { value: "手动修订" } });
    expect(editor.state.rows[0]?.values.title).toBe("手动修订");
  });
  it("uses native modal dialogs, requires save confirmation and handles discard", async () => {
    const editor = fixture();
    const passive = Vue.defineComponent({ setup: () => () => null });
    const component = evaluateModule<{ default: Vue.Component }>(
      compileSfc(dialogSource, "AlbumTagDialog.vue"),
      {
        vue: Vue,
        "@/albumTags/editor": { useAlbumTagEditor: () => editor },
        "@/metadata/model": metadata,
        "@/albumTags/ui/ReleaseSearch.vue": passive,
        "@/albumTags/ui/AlbumTagFields.vue": passive,
        "@/albumTags/ui/TrackMapping.vue": passive,
      },
    ).default;
    const root = createDialogNode("root");
    const app = createHostRenderer(createDialogNode).createApp(component);
    app.mount(root);
    apps.push(app);
    await editor.open(album);
    editor.selectRelease(release().summary.id);
    await settle();
    const main = node(
      root,
      (entry) => entry.props["aria-labelledby"] === "album-tags-title",
    ) as DialogNode;
    expect(main.open).toBe(true);
    const save = node(
      root,
      (entry) => entry.type === "button" && getTextContent(entry).trim() === "保存",
    );
    event(save, "onClick");
    await settle();
    expect(getTextContent(root)).toContain("保存后不可撤销");
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
    editor.confirmDiscard();
    await settle();
    expect(main.open).toBe(false);
  });
});
