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
async function run(fail = false) {
  const opened: number[][] = [];
  const ids: number[][] = [];
  const messages: unknown[] = [];
  const events: string[] = [];
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "ReleaseMenuItem.vue"),
    {
      vue: Vue,
      "@/features/metadata/releases/useEditor": {
        useReleaseEditor: () => ({
          state: Vue.reactive({ open: false }),
          openTracks: async (targets: number[]) => {
            events.push("open");
            if (fail) throw new Error("Unexpected menu error");
            opened.push(targets);
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
it("opens numeric library or playlist selections without converting snapshots to paths", async () => {
  const context = await run();
  expect(context.ids).toEqual([]);
  expect(context.opened).toEqual([[1, 2, 1]]);
  expect(context.events).toEqual(["close", "open"]);
  expect(context.messages).toEqual([]);
});
it("does not hide unexpected editor failures in a second notification layer", async () => {
  await expect(run(true)).rejects.toThrow("Unexpected menu error");
});
