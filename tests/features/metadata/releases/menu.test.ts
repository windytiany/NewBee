import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import { createHostNode, createHostRenderer, findNode } from "../../../support/host/renderer";

const apps: Vue.App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});
const source = await Bun.file(
  "src/features/metadata/releases/components/ReleaseMenuItem.vue",
).text();
async function run(paths: string[]) {
  const opened: string[][] = [];
  const ids: number[][] = [];
  const messages: unknown[] = [];
  const events: string[] = [];
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "ReleaseMenuItem.vue"),
    {
      vue: Vue,
      "@/features/tracks/api": {
        createTracksApi: () => ({
          getTracks: async (targets: number[]) => {
            ids.push(targets);
            return paths.map((path, index) => ({ id: index + 1, path }));
          },
        }),
      },
      "@/features/metadata/releases/useEditor": {
        useReleaseEditor: () => ({
          state: Vue.reactive({ open: false }),
          openFiles: async (paths: string[]) => {
            events.push("open");
            opened.push(paths);
          },
        }),
      },
      "@/shared/notifications/center": { notify: (message: unknown) => messages.push(message) },
    },
  ).default;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp(component, {
    trackIds: [1, 2, 1],
    onClose: () => events.push("close"),
  });
  app.mount(root);
  apps.push(app);
  const button = findNode(root, (node) => node.props.role === "menuitem");
  if (!button || typeof button.props.onClick !== "function")
    throw new Error("Missing release action");
  await button.props.onClick({ stopPropagation() {} });
  return { opened, ids, messages, events };
}
it("loads files for selected library or playlist tracks without assuming one album", async () => {
  const context = await run(["C:\\first.flac", "C:\\second.flac"]);
  expect(context.ids).toEqual([[1, 2, 1]]);
  expect(context.opened).toEqual([["C:\\first.flac", "C:\\second.flac"]]);
  expect(context.events).toEqual(["close", "open"]);
  expect(context.messages).toEqual([]);
});
it("does not open an incomplete selection and reports missing targets", async () => {
  const context = await run(["C:\\first.flac"]);
  expect(context.opened).toEqual([]);
  expect(context.messages).toEqual([{ type: "error", message: "读取本地标签失败，请查看日志" }]);
});
