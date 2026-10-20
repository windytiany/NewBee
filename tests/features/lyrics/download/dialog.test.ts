import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { setLocale } from "@/shared/i18n/locale";
import { createLyricsConfirmation } from "@/features/lyrics/download/confirmation";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";

const source = await Bun.file("src/features/lyrics/download/LyricsDownloadDialog.vue").text();
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  setLocale("zh-CN");
  for (const app of apps.splice(0)) app.unmount();
});
interface DialogNode extends HostNode {
  children: DialogNode[];
  parent: DialogNode | null;
  open: boolean;
  showModal: () => void;
  close: () => void;
}
function node(type: string, text = ""): DialogNode {
  const element: DialogNode = {
    ...createHostNode(type, text),
    children: [],
    parent: null,
    open: false,
    showModal: () => {
      element.open = true;
    },
    close: () => {
      element.open = false;
    },
  };
  return element;
}
async function mount() {
  const started: number[][] = [];
  const confirmation = createLyricsConfirmation({
    targets: async () => [
      { id: 1, title: "Missing", artist: "Artist", hasLyrics: false, noLyrics: false },
      { id: 2, title: "Existing", artist: "Artist", hasLyrics: true, noLyrics: false },
      { id: 3, title: "Instrumental", artist: "Artist", hasLyrics: false, noLyrics: true },
    ],
    loadAlbum: async () => [],
    running: () => false,
    start: async (ids) => {
      started.push(ids);
    },
  });
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "LyricsDownloadDialog.vue"),
    {
      vue: Vue,
      "@/features/lyrics/download/confirmation": { useLyricsConfirmation: () => confirmation },
    },
  ).default;
  const root = node("root");
  const app = createHostRenderer(node).createApp(component);
  app.mount(root);
  apps.push(app);
  await confirmation.openTracks([1, 2, 3]);
  await Vue.nextTick();
  await Vue.nextTick();
  return { root, confirmation, started };
}
it("reacts to locale changes in counts, actions and accessible labels without translating track data", async () => {
  const { root, confirmation } = await mount();
  expect(getTextContent(root)).toContain("已选 1 / 3 首");
  setLocale("en");
  await Vue.nextTick();
  expect(getTextContent(root)).toContain("Selected 1 / 3 tracks");
  expect(getTextContent(root)).toContain("Update");
  expect(getTextContent(root)).not.toContain("Start update");
  expect(getTextContent(root)).toContain("Marked as having no lyrics");
  expect(
    findNode(root, (entry) => entry.props["aria-label"] === "Select Missing")?.props.checked,
  ).toBe(true);
  confirmation.selectAll(true);
  await Vue.nextTick();
  expect(getTextContent(root)).toContain("Selected 3 / 3 tracks");
  expect(getTextContent(root)).toContain("Instrumental");
  setLocale("zh-CN");
  await Vue.nextTick();
  expect(getTextContent(root)).toContain("已选 3 / 3 首");
});
it("opens a modal with database states without explanatory text", async () => {
  const { root, started } = await mount();
  expect((findNode(root, (entry) => entry.type === "dialog") as DialogNode).open).toBe(true);
  expect(getTextContent(root)).not.toContain("选中的曲目允许覆盖原歌词");
  expect(findNode(root, (entry) => entry.props.id === "lyrics-download-description")).toBeNull();
  expect(
    findNode(root, (entry) => entry.type === "dialog")?.props["aria-describedby"],
  ).toBeUndefined();
  expect(getTextContent(root)).toContain("已有歌词");
  expect(getTextContent(root)).toContain("已标记为无歌词");
  expect(
    findNode(root, (entry) => entry.props["aria-label"] === "选择 Missing")?.props.checked,
  ).toBe(true);
  expect(
    findNode(root, (entry) => entry.props["aria-label"] === "选择 Existing")?.props.checked,
  ).toBe(false);
  expect(
    findNode(root, (entry) => entry.props["aria-label"] === "选择 Instrumental")?.props.checked,
  ).toBe(false);
  expect(started).toEqual([]);
  const start = findNode(
    root,
    (entry) => entry.type === "button" && getTextContent(entry).trim() === "更新",
  );
  expect(start?.props.disabled).toBe(false);
  await (start?.props.onClick as () => Promise<void>)();
  expect(started).toEqual([[1]]);
});
it("disables start for an empty selection and closes on Escape without downloading", async () => {
  const { root, confirmation, started } = await mount();
  confirmation.selectAll(false);
  await Vue.nextTick();
  expect(
    findNode(root, (entry) => entry.type === "button" && getTextContent(entry).trim() === "更新")
      ?.props.disabled,
  ).toBe(true);
  const dialog = findNode(root, (entry) => entry.type === "dialog") as DialogNode;
  (dialog.props.onCancel as (event: { preventDefault: () => void }) => void)({
    preventDefault() {},
  });
  await Vue.nextTick();
  await Vue.nextTick();
  expect(dialog.open).toBe(false);
  expect(started).toEqual([]);
});
