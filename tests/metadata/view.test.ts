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
import { createMetadataEditor } from "@/metadata/editor";
import { METADATA_FIELDS } from "@/metadata/model";
import type { EditableTrack, MetadataChange } from "@/metadata/model";

const dialogSource = await Bun.file("src/metadata/ui/MetadataEditorDialog.vue").text();
const menuSource = await Bun.file("src/metadata/ui/MetadataEditMenuItem.vue").text();
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});
interface DialogNode extends HostNode {
  children: DialogNode[];
  parent: DialogNode | null;
  open: boolean;
  style: { display: string };
  focus: () => void;
  showModal: () => void;
  close: () => void;
}
function createNode(type: string, text = ""): DialogNode {
  const node: DialogNode = {
    ...createHostNode(type, text),
    children: [],
    parent: null,
    open: false,
    style: { display: "" },
    focus: () => {},
    showModal: () => {
      node.open = true;
    },
    close: () => {
      node.open = false;
    },
  };
  return node;
}
function track(id: number): EditableTrack {
  return {
    track: {
      id,
      path: `/music/${id}.mp3`,
      title: `Database title ${id}`,
      artist: "Artist",
      album: "Album",
      albumArtist: "Group",
      releaseDate: null,
      trackNumber: id,
      discNumber: 1,
      trackTotal: 7,
      discTotal: 2,
      durationMs: 1000,
      codec: "MP3",
      sampleRateHz: 44100,
      bitrateKbps: 128,
      channels: 2,
    },
    lyrics: "[00:01.00]Original lyrics\n[00:02.00]Second line",
    writableFields: [...METADATA_FIELDS.map(({ key }) => key), "lyrics"],
    issue: null,
  };
}
async function settle() {
  await Vue.nextTick();
  await Vue.nextTick();
}
function mountDialog(readOnly = false) {
  const saved: MetadataChange[][] = [];
  const editor = createMetadataEditor({
    loadTracks: async (ids) =>
      ids.map((id) => ({
        ...track(id),
        writableFields: readOnly ? [] : track(id).writableFields,
      })),
    loadAlbum: async () => [1, 2],
    save: async (ids, changes) => {
      saved.push(changes);
      return ids.map((trackId) => ({
        trackId,
        path: `/music/${trackId}.mp3`,
        fileWritten: true,
        databaseUpdated: true,
        error: null,
      }));
    },
    synchronize: async () => {},
    notify: () => 1,
  });
  const component = evaluateModule<{ default: Vue.Component }>(
    compileSfc(dialogSource, "MetadataEditorDialog.vue"),
    {
      vue: Vue,
      "@/metadata/editor": { useMetadataEditor: () => editor },
      "@/artwork/ui/TrackArtwork.vue": Vue.defineComponent({ setup: () => () => null }),
      "@/library/formatTrack": { formatTrackDuration: () => "0:01" },
    },
  ).default;
  const root = createNode("root");
  const app = createHostRenderer(createNode).createApp(component);
  app.mount(root);
  apps.push(app);
  return { editor, root, saved };
}
function input(root: HostNode, id: string) {
  const node = findNode(root, (entry) => entry.props.id === `metadata-${id}`);
  if (!node) throw new Error(`Missing ${id} input`);
  return node;
}

describe("metadata editor views", () => {
  it("shows a native modal with database values, allows unchanged saves and does not close on the backdrop", async () => {
    const { editor, root } = mountDialog();
    await editor.openTracks([1]);
    await settle();
    const dialog = findNode(root, (node) => node.type === "dialog") as DialogNode | null;
    expect(dialog?.open).toBe(true);
    expect(dialog?.props.onClick).toBeUndefined();
    expect(input(root, "title").props.value).toBe("Database title 1");
    expect(findNode(root, (node) => node.props.type === "submit")?.props.disabled).toBe(false);
    const onInput = input(root, "title").props.onInput as (event: {
      target: { value: string };
    }) => void;
    onInput({ target: { value: "New title" } });
    const onCancel = dialog?.props.onCancel as (event: { preventDefault: () => void }) => void;
    onCancel({ preventDefault() {} });
    await settle();
    expect(editor.state.confirmDiscard).toBe(true);
    expect(dialog?.open).toBe(true);
    const confirmation = findNode(root, (node) => node.props.role === "alertdialog") as DialogNode;
    expect(confirmation.open).toBe(true);
    expect(confirmation.parent).toBe(dialog?.parent ?? null);
    expect(getTextContent(confirmation)).toContain("未保存的修改将丢失");
  });

  it("cancels discard confirmation without losing edits and closes both dialogs when discarding", async () => {
    const { editor, root, saved } = mountDialog();
    await editor.openTracks([1]);
    await settle();
    const dialog = findNode(
      root,
      (node) => node.props["aria-labelledby"] === "metadata-editor-title",
    ) as DialogNode;
    const confirmation = findNode(root, (node) => node.props.role === "alertdialog") as DialogNode;
    expect(confirmation.open).toBe(false);
    (input(root, "title").props.onInput as (event: { target: { value: string } }) => void)({
      target: { value: "Unsaved title" },
    });
    expect(editor.state.dirty).toBe(true);
    const cancelEditor = findNode(
      dialog,
      (node) => node.type === "button" && getTextContent(node).trim() === "取消",
    );
    (cancelEditor?.props.onClick as () => void)();
    await settle();
    expect(editor.state.confirmDiscard).toBe(true);
    expect(findNode(root, (node) => node.props.role === "alertdialog")).toBe(confirmation);
    expect(dialog.open).toBe(true);
    expect(confirmation.open).toBe(true);
    expect(input(root, "title").props.disabled).toBe(true);
    const cancelDiscard = findNode(
      confirmation,
      (node) => node.type === "button" && getTextContent(node).trim() === "取消",
    );
    expect(cancelDiscard?.props.autofocus).toBeDefined();
    (cancelDiscard?.props.onClick as () => void)();
    await settle();
    expect(confirmation.open).toBe(false);
    expect(dialog.open).toBe(true);
    expect(editor.state.dirty).toBe(true);
    expect(input(root, "title").props.value).toBe("Unsaved title");
    expect(input(root, "title").props.disabled).toBe(false);

    editor.requestClose();
    await settle();
    (confirmation.props.onCancel as (event: { preventDefault: () => void }) => void)({
      preventDefault() {},
    });
    await settle();
    expect(confirmation.open).toBe(false);
    expect(dialog.open).toBe(true);

    editor.requestClose();
    await settle();
    const discard = findNode(
      confirmation,
      (node) => node.type === "button" && getTextContent(node).trim() === "丢弃",
    );
    (discard?.props.onClick as () => void)();
    await settle();
    expect(confirmation.open).toBe(false);
    expect(dialog.open).toBe(false);
    expect(editor.state.open).toBe(false);
    expect(saved).toHaveLength(0);
  });

  it("closes immediately without confirmation when nothing has been edited", async () => {
    const { editor, root } = mountDialog();
    await editor.openTracks([1]);
    await settle();
    editor.requestClose();
    await settle();
    expect(editor.state.open).toBe(false);
    expect((findNode(root, (node) => node.props.role === "alertdialog") as DialogNode).open).toBe(
      false,
    );
  });

  it("keeps unavailable fields read-only and disables saving when nothing is writable", async () => {
    const { editor, root } = mountDialog(true);
    await editor.openTracks([1]);
    await settle();
    expect(input(root, "lyrics").props.readonly).toBe(true);
    expect(input(root, "lyrics").props.value).toContain("Original lyrics");
    expect(input(root, "title").props.readonly).toBe(true);
    expect(input(root, "title").props.value).toBe("Database title 1");
    expect(findNode(root, (node) => node.props.type === "submit")?.props.disabled).toBe(true);
  });

  it("shows only common tags for multiple targets without application controls or file information", async () => {
    const { editor, root, saved } = mountDialog();
    await editor.openTracks([1, 2]);
    await settle();
    expect(input(root, "title").props.placeholder).toContain("多个值");
    expect(findNode(root, (node) => node.props.type === "checkbox")).toBeNull();
    expect(findNode(root, (node) => node.props.id === "metadata-panel-properties")).toBeNull();
    expect(findNode(root, (node) => node.props.id === "metadata-tab-lyrics")).toBeNull();
    expect(findNode(root, (node) => node.props.id === "metadata-lyrics")).toBeNull();
    expect(getTextContent(root)).toContain("2 首曲目");
    expect(getTextContent(root)).not.toContain("/music/");
    expect(getTextContent(root)).not.toContain("以数据库值为准");
    expect(getTextContent(root)).not.toContain("清空");
    (
      input(root, "title").props.onKeydown as (event: {
        key: string;
        preventDefault: () => void;
      }) => void
    )({ key: "Delete", preventDefault() {} });
    await settle();
    expect(input(root, "title").props.value).toBe("");
    expect(input(root, "title").props.placeholder).toBe("");
    expect(editor.state.draft.find(({ key }) => key === "title")?.mixed).toBe(false);
    (input(root, "title").props.onInput as (event: { target: { value: string } }) => void)({
      target: { value: "Unified" },
    });
    await settle();
    expect(input(root, "title").props.value).toBe("Unified");
    expect(input(root, "title").props.placeholder).toBe("");
    const form = findNode(root, (node) => node.type === "form");
    (form?.props.onSubmit as (event: { preventDefault: () => void }) => void)({
      preventDefault() {},
    });
    await settle();
    expect(saved).toHaveLength(1);
    expect(getTextContent(root)).not.toContain("确认写入");
  });

  it("separates single-track properties and tags and groups each number with its total", async () => {
    const { editor, root } = mountDialog();
    await editor.openTracks([1]);
    await settle();
    const propertiesTab = findNode(root, (node) => node.props.id === "metadata-tab-properties");
    const tagsTab = findNode(root, (node) => node.props.id === "metadata-tab-tags");
    expect(tagsTab?.props["aria-selected"]).toBe(true);
    expect(propertiesTab?.props["aria-selected"]).toBe(false);
    expect(getTextContent(root)).not.toContain("1 首曲目");
    expect(getTextContent(root)).not.toContain("清空");
    expect(input(root, "trackNumber").props.value).toBe("1");
    expect(input(root, "trackTotal").props.value).toBe("7");
    expect(input(root, "discTotal").props.value).toBe("2");
    expect(input(root, "trackNumber").parent?.parent).toBe(
      input(root, "trackTotal").parent?.parent,
    );
    (propertiesTab?.props.onClick as () => void)();
    await settle();
    expect(propertiesTab?.props["aria-selected"]).toBe(true);
    expect(getTextContent(root)).toContain("/music/1.mp3");
  });

  it("shows editable raw lyrics in a single-track tab and supports keyboard navigation", async () => {
    const { editor, root, saved } = mountDialog();
    await editor.openTracks([1]);
    await settle();
    const lyricsTab = findNode(root, (node) => node.props.id === "metadata-tab-lyrics");
    const tagsTab = findNode(root, (node) => node.props.id === "metadata-tab-tags");
    expect(input(root, "lyrics").type).toBe("textarea");
    expect(input(root, "lyrics").props.placeholder).toBe("无歌词");
    expect(getTextContent(root)).not.toContain("可编辑纯文本");
    expect(findNode(root, (node) => node.props["aria-label"] === "歌词说明")).toBeNull();
    expect(input(root, "lyrics").props.value).toBe(
      "[00:01.00]Original lyrics\n[00:02.00]Second line",
    );
    (tagsTab?.props.onKeydown as (event: { key: string; preventDefault: () => void }) => void)({
      key: "ArrowRight",
      preventDefault() {},
    });
    await settle();
    expect(lyricsTab?.props["aria-selected"]).toBe(true);
    expect(
      (findNode(root, (node) => node.props.id === "metadata-panel-lyrics") as DialogNode).style
        .display,
    ).not.toBe("none");
    (input(root, "lyrics").props.onInput as (event: { target: { value: string } }) => void)({
      target: { value: "[00:03.00]Edited lyrics" },
    });
    expect(editor.state.dirty).toBe(true);
    const form = findNode(root, (node) => node.type === "form");
    (form?.props.onSubmit as (event: { preventDefault: () => void }) => void)({
      preventDefault() {},
    });
    await settle();
    expect(saved[0]?.find(({ field }) => field === "lyrics")?.value).toBe(
      "[00:03.00]Edited lyrics",
    );
  });

  it("the edit menu captures track IDs before closing and supports album targets", async () => {
    const calls: Array<number[] | { albumArtist: string | null; album: string | null }> = [];
    const state = Vue.reactive({ open: false });
    const component = evaluateModule<{ default: Vue.Component }>(
      compileSfc(menuSource, "MetadataEditMenuItem.vue"),
      {
        vue: Vue,
        "@/metadata/editor": {
          useMetadataEditor: () => ({
            state,
            openTracks: (ids: number[]) => calls.push(ids),
            openAlbum: (album: { albumArtist: string | null; album: string | null }) =>
              calls.push(album),
          }),
        },
      },
    ).default;
    const root = createNode("root");
    const ids = [1, 2];
    const app = createHostRenderer(createNode).createApp(component, {
      trackIds: ids,
      onClose: () => {
        ids.length = 0;
      },
    });
    app.mount(root);
    apps.push(app);
    const button = findNode(root, (node) => node.type === "button");
    (button?.props.onClick as (event: { stopPropagation: () => void }) => void)({
      stopPropagation() {},
    });
    expect(calls).toEqual([[1, 2]]);
    const album = { albumArtist: "Group", album: "Album" };
    const albumRoot = createNode("root");
    const albumApp = createHostRenderer(createNode).createApp(component, { album });
    albumApp.mount(albumRoot);
    apps.push(albumApp);
    const albumButton = findNode(albumRoot, (node) => node.type === "button");
    (albumButton?.props.onClick as (event: { stopPropagation: () => void }) => void)({
      stopPropagation() {},
    });
    expect(calls[1]).toEqual(album);
    state.open = true;
    await settle();
    expect(albumButton?.props.disabled).toBe(true);
  });
});
