import type { ArtworkCollection, ArtworkDraft } from "@/features/artwork/collection/types";
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
import { createTagEditor } from "@/features/metadata/manual/useEditor";
import { TAG_FIELDS } from "@/features/metadata/draft";
import type { EditableTrack, TagChange } from "@/features/metadata/types";

const dialogSource = await Bun.file(
  "src/features/metadata/manual/components/TagEditorDialog.vue",
).text();
const menuSource = await Bun.file(
  "src/features/metadata/manual/components/EditMenuItem.vue",
).text();
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  setLocale("zh-CN");
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
      trackNumber: typeof id === "number" ? id : null,
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
    noLyrics: false,
    writableFields: [...TAG_FIELDS.map(({ key }) => key), "lyrics"],
    issue: null,
  };
}
async function settle() {
  await Vue.nextTick();
  await Vue.nextTick();
}
function mountDialog(
  readOnly = false,
  marked = false,
  synchronize: () => Promise<void> = async () => {},
  downloading = false,
  collections?: ArtworkCollection[],
) {
  const saved: TagChange[][] = [];
  const savedActions: string[] = [];
  const savedArtwork: Array<{ drafts: ArtworkDraft[] }> = [];
  const editor = createTagEditor({
    loadTracks: async (ids) =>
      ids.map((id) => ({
        ...track(id),
        lyrics: marked ? null : track(id).lyrics,
        noLyrics: marked,
        writableFields: readOnly ? [] : track(id).writableFields,
      })),
    loadCollections: async (ids) =>
      collections ??
      ids.map((trackId) => ({
        trackId,
        pictures: [],
        displayIndex: null,
        error: null,
      })),
    planArtwork: async (drafts) =>
      drafts.map(({ trackId }) => ({ trackId, fileWriteRequired: true, error: null })),
    readArtwork: async () => {
      throw new Error("No artwork in this fixture");
    },
    loadAlbum: async () => [1, 2],
    save: async (ids, changes, _progress, action, _operation, drafts) => {
      savedArtwork.push({ drafts });
      saved.push(changes);
      savedActions.push(action);
      return ids.map((trackId) => ({
        trackId,
        path: `/music/${trackId}.mp3`,
        fileWritten: true,
        databaseUpdated: true,
        error: null,
      }));
    },
    synchronize,
    editFiles: (_ids, save) => save(),
  });
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(dialogSource, "TagEditorDialog.vue"),
    {
      vue: Vue,
      "@tauri-apps/api/core": { isTauri: () => false },
      "@/features/artwork/collection/useDrop": { usePictureDrop: () => Vue.ref(null) },
      "@/features/metadata/manual/useEditor": { useTagEditor: () => editor },
      "@/features/lyrics/download/batch": {
        useLyricsBatch: () => ({ state: { running: downloading } }),
      },
      "@/features/lyrics/download/LyricsSearch.vue": Vue.defineComponent({
        setup: () => () =>
          Vue.h("div", [
            Vue.h("button", { type: "button" }, "自动获取"),
            Vue.h("button", { type: "button" }, "手动搜索"),
          ]),
      }),
      "@/features/artwork/collection/ArtworkPreview.vue": Vue.defineComponent({
        props: { selection: Object, disabled: Boolean, exportable: Boolean, exportMenu: Boolean },
        setup:
          (props, { slots }) =>
          () =>
            Vue.h(
              "div",
              {
                "data-artwork-preview": true,
                "data-mixed": props.selection?.mixed,
                "data-disabled": props.disabled,
                "data-exportable": props.exportable,
                "data-export-menu": props.exportMenu,
              },
              [slots.details?.(), slots.actions?.({ save: () => {}, disabled: props.disabled })],
            ),
      }),
      "@/features/artwork/transfer": {
        readClipboardCover: async () => [1, 2, 3],
        pictureMimeType: async () => "image/png",
        selectCover: async () => ({ path: "D:/cover.png", data: Uint8Array.from([1, 2, 3]) }),
      },
      "@/features/tracks/format": { formatTrackDuration: () => "0:01" },
    },
  ).default;
  const root = createNode("root");
  const app = createHostRenderer(createNode).createApp(component);
  app.mount(root);
  apps.push(app);
  return { editor, root, saved, savedActions, savedArtwork };
}
function input(root: HostNode, id: string) {
  const node = findNode(root, (entry) => entry.props.id === `metadata-${id}`);
  if (!node) throw new Error(`Missing ${id} input`);
  return node;
}

describe("metadata editor views", () => {
  it("disables tag autocomplete and aligns additional inputs with a shared label width", async () => {
    const { editor, root } = mountDialog();
    await editor.openTracks([1]);
    await settle();
    const form = findNode(root, (node) => node.props.id === "metadata-editor-form");
    expect(form?.props.autocomplete).toBe("off");
    const panel = findNode(root, (node) => node.props.id === "metadata-panel-additional");
    if (!panel) throw new Error("Missing additional tags panel");
    for (const field of editor.state.draft) {
      if (field.key === "lyrics") continue;
      const node = input(root, field.key);
      expect(node.props.autocomplete).toBe("off");
      const label = findNode(panel, (entry) => entry.props.for === `metadata-${field.key}`);
      if (!label) continue;
      expect(label.props.class).toContain("whitespace-nowrap");
      expect(label.parent?.props.class).toContain("grid-cols-[11rem_minmax(0,1fr)]");
    }
  });
  it("updates field and property labels after opening without changing draft values", async () => {
    const { editor, root } = mountDialog();
    await editor.openTracks([1, 2]);
    await settle();
    expect(getTextContent(root)).toContain("2 首曲目");
    setLocale("en");
    await settle();
    expect(getTextContent(root)).toContain("2 tracks");
    expect(input(root, "title").props["aria-label"]).toBe("Title");
    expect(input(root, "title").props.placeholder).toBe("Multiple values");
    expect(getTextContent(root)).toContain("Mark all as having no lyrics");
    editor.close();
    await editor.openTracks([1]);
    await settle();
    expect(getTextContent(root)).toContain("Location");
    expect(input(root, "title").props.value).toBe("Database title 1");
    setLocale("zh-CN");
    await settle();
    expect(getTextContent(root)).toContain("位置");
    expect(input(root, "title").props["aria-label"]).toBe("标题");
    expect(input(root, "title").props.value).toBe("Database title 1");
  });
  it("keeps tag artwork read-only and manages pictures in a separate tab", async () => {
    const { editor, root } = mountDialog();
    await editor.openTracks([1]);
    await settle();
    const tags = findNode(root, (node) => node.props.id === "metadata-panel-tags");
    if (!tags) throw new Error("Missing tags panel");
    const preview = findNode(tags, (node) => node.props["data-artwork-preview"] === true);
    expect(preview?.props["data-exportable"]).toBe(true);
    expect(preview?.props["data-export-menu"]).toBe(true);
    expect(getTextContent(tags)).not.toContain("保存封面");
    expect(preview?.parent?.children.indexOf(preview)).toBe(0);
    expect(findNode(tags, (node) => node.props.type === "file")).toBeNull();
    expect(getTextContent(tags)).not.toContain("添加图片");
    const tab = findNode(root, (node) => node.props.id === "metadata-tab-artwork");
    (tab?.props.onClick as () => void)();
    await settle();
    expect(tab?.props["aria-selected"]).toBe(true);
    expect(
      findNode(root, (node) => node.type === "button" && getTextContent(node) === "添加")?.props
        .disabled,
    ).toBe(false);
    expect(editor.state.dirty).toBe(false);
  });

  it("blocks global save and close while a picture awaits confirmation and restores them on cancel", async () => {
    const { editor, root, saved } = mountDialog();
    await editor.openTracks([1]);
    await settle();
    (
      findNode(root, (node) => node.props.id === "metadata-tab-artwork")?.props
        .onClick as () => void
    )();
    await settle();
    (
      findNode(root, (node) => node.type === "button" && getTextContent(node) === "添加")?.props
        .onClick as () => void
    )();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    const outer = findNode(
      root,
      (node) => node.props["aria-labelledby"] === "metadata-editor-title",
    );
    const addition = findNode(
      root,
      (node) => node.type === "dialog" && node.props["aria-label"] === "添加图片",
    );
    expect(addition).not.toBeNull();
    const save = findNode(
      root,
      (node) => node.props.form === "metadata-editor-form" && node.props.type === "submit",
    );
    expect(save?.props.disabled).toBe(true);
    const outerCancel = findNode(
      outer!,
      (node) =>
        node.type === "button" && getTextContent(node) === "取消" && node.parent?.type === "footer",
    );
    expect(outerCancel?.props.disabled).toBe(true);
    (
      findNode(root, (node) => node.props.id === "metadata-editor-form")?.props.onSubmit as (
        event: object,
      ) => void
    )({ preventDefault() {} });
    (outer?.props.onCancel as (event: object) => void)({ preventDefault() {} });
    expect(saved).toEqual([]);
    expect(editor.state.open).toBe(true);
    expect(editor.state.confirmDiscard).toBe(false);
    expect(editor.state.dirty).toBe(false);
    expect(editor.state.artwork.tracks[0]?.pictures).toEqual([]);
    (
      findNode(addition!, (node) => node.type === "button" && getTextContent(node) === "取消")
        ?.props.onClick as () => void
    )();
    await settle();
    expect(
      findNode(root, (node) => node.type === "dialog" && node.props["aria-label"] === "添加图片"),
    ).toBeNull();
    expect(save?.props.disabled).toBe(false);
    expect(outerCancel?.props.disabled).toBe(false);
    expect(editor.state.dirty).toBe(false);
  });

  it("keeps uncommon fields in a separate tab and preserves edits across tab switches", async () => {
    const { editor, root, saved } = mountDialog();
    await editor.openTracks([1]);
    await settle();
    const tags = findNode(root, (node) => node.props.id === "metadata-panel-tags") as DialogNode;
    const additional = findNode(
      root,
      (node) => node.props.id === "metadata-panel-additional",
    ) as DialogNode;
    const tab = findNode(root, (node) => node.props.id === "metadata-tab-additional");
    expect(additional.style.display).toBe("none");
    for (const key of [
      "artistSort",
      "albumArtistSort",
      "discSubtitle",
      "label",
      "originalReleaseDate",
    ]) {
      expect(findNode(tags, (node) => node.props.id === `metadata-${key}`)).toBeNull();
      expect(findNode(additional, (node) => node.props.id === `metadata-${key}`)).not.toBeNull();
    }
    expect(findNode(tags, (node) => node.props.id === "metadata-releaseDate")).not.toBeNull();
    (tab?.props.onClick as () => void)();
    await settle();
    expect(tab?.props["aria-selected"]).toBe(true);
    expect(additional.style.display).not.toBe("none");
    expect(tags.style.display).toBe("none");
    (input(root, "label").props.onInput as (event: { target: { value: string } }) => void)({
      target: { value: "New label" },
    });
    const tagsTab = findNode(root, (node) => node.props.id === "metadata-tab-tags");
    (tagsTab?.props.onClick as () => void)();
    await settle();
    expect(input(root, "label").props.value).toBe("New label");
    editor.prepareSave();
    await settle();
    expect(saved[0]?.find(({ field }) => field === "label")?.value).toBe("New label");
  });

  it("groups album totals on one row with both labels and shows its cover", async () => {
    const { editor, root } = mountDialog();
    await editor.openAlbum({ albumArtist: "Group", album: "Album" });
    await settle();
    const totalsRow = input(root, "trackTotal").parent?.parent;
    expect(totalsRow).toBe(input(root, "discTotal").parent?.parent);
    expect(totalsRow?.props.class).toContain("grid-cols-2");
    expect(getTextContent(totalsRow!)).toContain("总曲数");
    expect(getTextContent(totalsRow!)).toContain("总碟数");
    expect(getTextContent(totalsRow!)).not.toContain("共");
    expect(findNode(root, (node) => node.props.id === "metadata-trackNumber")).toBeNull();
    expect(
      findNode(root, (node) => node.props["data-artwork-preview"] === true)?.props["data-mixed"],
    ).toBe(false);
  });
  for (const [path, displayedPath] of [
    [String.raw`\\?\C:\Music\song.mp3`, String.raw`C:\Music\song.mp3`],
    [String.raw`\\?\UNC\server\music\song.mp3`, String.raw`\\server\music\song.mp3`],
    [String.raw`C:\Music\song.mp3`, String.raw`C:\Music\song.mp3`],
    ["/music/song.mp3", "/music/song.mp3"],
    [String.raw`\\?\Volume{test}\song.mp3`, String.raw`\\?\Volume{test}\song.mp3`],
  ]) {
    it(`formats the property location without changing the stored path: ${path}`, async () => {
      const { editor, root } = mountDialog();
      await editor.openTracks([1]);
      const editable = editor.state.tracks[0];
      if (!editable || !path) throw new Error("Missing editable track or path");
      editable.track.path = path;
      await settle();
      const panel = findNode(root, (node) => node.props.id === "metadata-panel-properties");
      if (!panel) throw new Error("Missing properties panel");
      expect(findNode(panel, (node) => node.type === "dd")?.text).toBe(displayedPath);
      expect(editable.track.path).toBe(path);
    });
  }

  it("keeps saving disabled during lyrics download without explanatory warning text", async () => {
    const { editor, root } = mountDialog(false, false, async () => {}, true);
    await editor.openTracks([1, 2]);
    editor.changeLyricsAction("mark");
    await settle();
    expect(findNode(root, (node) => node.props.type === "submit")?.props.disabled).toBe(true);
    expect(getTextContent(root)).not.toContain("暂时无法保存标签");
    expect(getTextContent(root)).not.toContain("保存时将清除");
  });

  it("hides refresh error details and retry controls while retaining saved outcomes", async () => {
    let refreshes = 0;
    const { editor, root, saved } = mountDialog(false, false, async () => {
      refreshes++;
      if (refreshes === 1) throw new Error("reload failed");
    });
    await editor.openTracks([1]);
    const title = editor.state.draft.find(({ key }) => key === "title");
    if (!title) throw new Error("Missing title");
    editor.changeField(title, "Edited title");
    editor.prepareSave();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await settle();
    expect(getTextContent(root)).not.toContain("reload failed");
    expect(getTextContent(root)).not.toContain("重试");
    expect(editor.state.results[0]?.databaseUpdated).toBe(true);
    expect(editor.state.synchronizationError).toContain("reload failed");
    expect(refreshes).toBe(1);
    expect(saved).toHaveLength(1);
    expect(editor.state.open).toBe(true);
  });

  it("shows a native modal with database values and does not close on the backdrop", async () => {
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
    expect(
      findNode(input(root, "title").parent!.parent!, (node) => node.props.type === "checkbox"),
    ).toBeNull();
    expect(findNode(root, (node) => node.props.id === "metadata-panel-properties")).toBeNull();
    expect(findNode(root, (node) => node.props.id === "metadata-tab-lyrics")).not.toBeNull();
    expect(findNode(root, (node) => node.props.id === "metadata-lyrics-action")?.props.value).toBe(
      "keep",
    );
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

  it("places lyric search actions at the bottom right on the same row as the mark checkbox", async () => {
    const { editor, root, saved, savedActions } = mountDialog();
    await editor.openTracks([1]);
    await settle();
    expect(findNode(root, (node) => node.props.id === "metadata-lyrics-action")).toBeNull();
    const checkbox = input(root, "no-lyrics");
    const textarea = input(root, "lyrics");
    expect(checkbox.props.type).toBe("checkbox");
    expect(checkbox.props.checked).toBe(false);
    expect(getTextContent(checkbox.parent!)).toContain("标记为无歌词");
    const panel = findNode(root, (node) => node.props.id === "metadata-panel-lyrics");
    if (!panel) throw new Error("Missing lyrics panel");
    const textareaIndex = panel.children.findIndex((node) =>
      findNode(node, (entry) => entry === textarea),
    );
    const checkboxIndex = panel.children.findIndex((node) =>
      findNode(node, (entry) => entry === checkbox),
    );
    expect(textareaIndex).toBeGreaterThanOrEqual(0);
    expect(checkboxIndex).toBeGreaterThan(textareaIndex);
    const actionRow = checkbox.parent?.parent;
    if (!actionRow) throw new Error("Missing lyrics action row");
    expect(actionRow.props.class).toContain("flex items-center justify-between");
    const searchActions = actionRow.children.find((node) =>
      String(node.props.class).includes("ml-auto"),
    );
    if (!searchActions) throw new Error("Missing right-aligned search actions");
    expect(getTextContent(searchActions)).toContain("自动获取");
    expect(getTextContent(searchActions)).toContain("手动搜索");
    expect(actionRow.children.indexOf(searchActions)).toBeGreaterThan(
      actionRow.children.indexOf(checkbox.parent!),
    );
    (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({
      target: { checked: true },
    });
    await settle();
    expect(checkbox.props.checked).toBe(true);
    expect(textarea.props.value).toBe("");
    expect(getTextContent(panel)).not.toContain("保存时将清除原有的内嵌歌词");
    editor.prepareSave();
    await settle();
    expect(saved).toEqual([[]]);
    expect(savedActions).toEqual(["mark"]);
  });

  it("loads the existing single-track mark and allows unchecking without writing lyrics", async () => {
    const { editor, root, saved, savedActions } = mountDialog(true, true);
    await editor.openTracks([1]);
    await settle();
    const checkbox = input(root, "no-lyrics");
    expect(checkbox.props.checked).toBe(true);
    expect(checkbox.props.disabled).toBe(false);
    (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({
      target: { checked: false },
    });
    await settle();
    expect(checkbox.props.checked).toBe(false);
    editor.prepareSave();
    await settle();
    expect(saved).toEqual([[]]);
    expect(savedActions).toEqual(["unmark"]);
  });

  it("unchecks the single-track mark when nonempty lyrics are entered", async () => {
    const { editor, root } = mountDialog(false, true);
    await editor.openTracks([1]);
    await settle();
    expect(input(root, "no-lyrics").props.checked).toBe(true);
    (input(root, "lyrics").props.onInput as (event: { target: { value: string } }) => void)({
      target: { value: "New lyrics" },
    });
    await settle();
    expect(input(root, "no-lyrics").props.checked).toBe(false);
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
    expect(input(root, "lyrics").props.placeholder).toBeUndefined();
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
    const additionalTab = findNode(root, (node) => node.props.id === "metadata-tab-additional");
    expect(additionalTab?.props["aria-selected"]).toBe(true);
    (
      additionalTab?.props.onKeydown as (event: { key: string; preventDefault: () => void }) => void
    )({
      key: "ArrowRight",
      preventDefault() {},
    });
    await settle();
    const artworkTab = findNode(root, (node) => node.props.id === "metadata-tab-artwork");
    expect(artworkTab?.props["aria-selected"]).toBe(true);
    (artworkTab?.props.onKeydown as (event: { key: string; preventDefault: () => void }) => void)({
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

  it("saves picture edits with read-only tags without a global embedding checkbox", async () => {
    const collections: ArtworkCollection[] = [1, 2].map((trackId) => ({
      trackId,
      pictures: [
        {
          contentId: "shared",
          mimeType: "image/png",
          byteLength: 3,
          pictureType: 3,
          artworkId: trackId * 10 + 1,
          source: "embedded",
          path: "",
          error: null,
        },
      ],
      displayIndex: 0,
      error: null,
    }));
    for (const storage of ["embedded", "manual"] as const) {
      for (const collection of collections)
        for (const picture of collection.pictures) {
          picture.source = storage;
          picture.path = storage === "manual" ? "/covers/shared.png" : "";
        }
      const { editor, root, saved, savedArtwork } = mountDialog(
        true,
        false,
        undefined,
        false,
        collections,
      );
      await editor.openTracks([1, 2]);
      await settle();
      const tab = findNode(root, (node) => node.props.id === "metadata-tab-artwork");
      (tab?.props.onClick as () => void)();
      await settle();
      expect(findNode(root, (node) => node.props.type === "checkbox")).toBeNull();
      const type = findNode(root, (node) => node.type === "select");
      (type?.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value: "4" },
      });
      await settle();
      expect(findNode(root, (node) => node.props.type === "submit")?.props.disabled).toBe(false);
      const form = findNode(root, (node) => node.type === "form");
      (form?.props.onSubmit as (event: { preventDefault: () => void }) => void)({
        preventDefault() {},
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await settle();
      expect(saved).toEqual([[]]);
      expect(savedArtwork[0]?.drafts).toHaveLength(2);
      expect(savedArtwork[0]?.drafts).toEqual(
        [1, 2].map((trackId) => ({
          trackId,
          pictures: [{ source: "existing", artworkId: trackId * 10 + 1, pictureType: 4 }],
          displayIndex: 0,
        })),
      );
      expect(editor.state.open).toBe(false);
      await editor.openTracks([1, 2]);
      await settle();
    }
  });

  it("discards picture drafts and embedding through the unified cancel interaction", async () => {
    const { editor, root, savedArtwork } = mountDialog(true);
    await editor.openTracks([1]);
    await editor.addPicture(Uint8Array.from([8]), "image/png");
    await settle();
    editor.requestClose();
    await settle();
    expect(editor.state.confirmDiscard).toBe(true);
    const confirmation = findNode(root, (node) => node.props.role === "alertdialog");
    const discard =
      confirmation &&
      findNode(confirmation, (node) => node.type === "button" && getTextContent(node) === "丢弃");
    (discard?.props.onClick as () => void)();
    await settle();
    expect(savedArtwork).toEqual([]);
    await editor.openTracks([1]);
    await settle();
    expect(editor.pictures.value).toEqual([]);
  });

  it("blocks save while importing and shows failed collection state without exposing empty drafts as editable", async () => {
    const { editor, root } = mountDialog(true, false, undefined, false, [
      { trackId: 1, pictures: [], displayIndex: null, error: "collection failed" },
    ]);
    await editor.openTracks([1]);
    await settle();
    expect(getTextContent(root)).toContain("图片集合加载失败");
    expect(findNode(root, (node) => node.props.type === "submit")?.props.disabled).toBe(true);
    editor.state.importingArtwork = true;
    await settle();
    expect(findNode(root, (node) => node.props.type === "submit")?.props.disabled).toBe(true);
    expect(editor.artworkReady.value).toBe(false);
    expect(editor.state.artwork.tracks[0]?.error).toBe("collection failed");
  });
  it("the edit menu captures track IDs before closing and supports album targets", async () => {
    const calls: Array<number[] | { albumArtist: string | null; album: string | null }> = [];
    const state = Vue.reactive({ open: false });
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(menuSource, "EditMenuItem.vue"),
      {
        vue: Vue,
        "@/features/metadata/manual/useEditor": {
          useTagEditor: () => ({
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
