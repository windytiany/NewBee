import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import { createHostNode, createHostRenderer, findNode } from "../../../support/host/renderer";

const apps: Vue.App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});
const source = await Bun.file("src/features/library/import/ImportMenuItem.vue").text();
async function mount(externalIds: number[], fail = false) {
  const queried: number[][] = [];
  const imported: string[][] = [];
  const messages: unknown[] = [];
  let closed = 0;
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "ImportMenuItem.vue"),
    {
      vue: Vue,
      "@/features/library/api": {
        createLibraryApi: () => ({
          listExternalTrackIds: async (ids: number[]) => {
            queried.push([...ids]);
            if (fail) throw new Error("database unavailable");
            return externalIds;
          },
        }),
      },
      "@/features/tracks/api": {
        createTracksApi: () => ({
          getTracks: async (ids: number[]) =>
            ids.map((id) => ({ id, path: `C:\\music\\${id}.flac` })),
        }),
      },
      "@/features/library/import/useFileImport": {
        useLibraryFileImport: () => ({
          isImporting: Vue.ref(false),
          importPaths: async (paths: string[]) => {
            imported.push(paths);
          },
        }),
      },
      "@/shared/notifications/center": { notify: (message: unknown) => messages.push(message) },
    },
  ).default;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp(component, {
    trackIds: [1, 2, 2],
    onClose: () => {
      closed++;
    },
  });
  app.mount(root);
  apps.push(app);
  for (let turn = 0; turn < 3; turn++) await Vue.nextTick();
  return {
    root,
    queried,
    imported,
    messages,
    get closed() {
      return closed;
    },
  };
}
it("imports only the external subset of mixed and duplicate playlist targets", async () => {
  const context = await mount([2]);
  const button = findNode(context.root, (node) => node.props.role === "menuitem");
  if (!button || typeof button.props.onClick !== "function")
    throw new Error("Missing import action");
  await button.props.onClick({ stopPropagation() {} });
  expect(context.queried).toEqual([[1, 2, 2]]);
  expect(context.imported).toEqual([["C:\\music\\2.flac"]]);
  expect(context.closed).toBe(1);
});
it("hides import when every selected track already belongs to the library", async () => {
  const context = await mount([]);
  expect(findNode(context.root, (node) => node.props.role === "menuitem")).toBeNull();
  expect(context.imported).toEqual([]);
});
it("reports membership lookup failures without importing or closing the menu", async () => {
  const context = await mount([], true);
  expect(context.messages).toEqual([{ type: "error", message: "添加到音乐库失败" }]);
  expect(context.imported).toEqual([]);
  expect(context.closed).toBe(0);
});
