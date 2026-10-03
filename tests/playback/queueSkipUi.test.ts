import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "../support/moduleLoader";
import { createHostNode, createHostRenderer, findNode } from "../support/hostRenderer";
import type { HostNode } from "../support/hostRenderer";

const source = await Bun.file("src/playback/ui/QueueList.vue").text();
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

it("maps multi-selected queue occurrences to global track IDs and synchronizes skip indicators", async () => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {} },
  });
  const row = Vue.defineComponent({
    props: ["trackId", "rowKey", "isSkipped"],
    emits: ["contextMenu"],
    setup:
      (props, { emit }) =>
      () =>
        Vue.h("button", {
          "data-row-key": props.rowKey,
          "data-skipped": props.isSkipped,
          onContextmenu: (event: { currentTarget: HostNode }) =>
            emit("contextMenu", { rowKey: props.rowKey, x: 0, y: 0, trigger: event.currentTarget }),
        }),
  });
  const menu = Vue.defineComponent({
    props: ["trackIds"],
    setup: (props) => () =>
      Vue.h("button", { "data-skip-targets": JSON.stringify(props.trackIds) }),
  });
  const component = evaluateModule<{ default: Vue.Component }>(
    compileSfc(source, "src/playback/ui/QueueList.vue"),
    {
      vue: Vue,
      "@/interaction/itemFocus": {
        useItemFocusList: () => ({
          isSelected: () => true,
          isFocused: () => false,
          syncVisibleItems: () => {},
          contextMenuTargets: (_rowKey: string, keys: string[]) => keys,
        }),
      },
      "@/notification/useNotification": { useNotification: () => {} },
      "@/library/formatTrack": { formatTrackDuration: () => "1:00" },
      "@/playback/ui/QueueRow.vue": row,
      "@/metadata/ui/MetadataEditMenuItem.vue": menu,
      "@/library/ui/TrackSkipMenuItem.vue": menu,
    },
  ).default;
  const skippedIds = Vue.ref([7]);
  const root = createHostNode("root");
  const app = createHostRenderer<HostNode>((type, text) =>
    Object.assign(createHostNode(type, text), { focus() {} }),
  ).createApp(
    Vue.defineComponent({
      setup: () => () =>
        Vue.h(component, {
          canRemoveFromQueue: true,
          skippedTrackIds: skippedIds.value,
          tracks: [7, 7, 8].map((trackId, index) => ({
            trackId,
            rowKey: String(index),
            title: "Track",
            album: "Album",
            durationMs: 100,
          })),
        }),
    }),
  );
  app.mount(root);
  apps.push(app);
  const first = findNode(root, (node) => node.props["data-row-key"] === "0")!;
  expect(first.props["data-skipped"]).toBe(true);
  expect(findNode(root, (node) => node.props["data-row-key"] === "1")?.props["data-skipped"]).toBe(
    true,
  );
  (first.props.onContextmenu as (event: { currentTarget: HostNode }) => void)({
    currentTarget: first,
  });
  await Vue.nextTick();
  expect(
    findNode(root, (node) => node.props["data-skip-targets"] !== undefined)?.props[
      "data-skip-targets"
    ],
  ).toBe("[7,7,8]");
  skippedIds.value = [];
  await Vue.nextTick();
  expect(first.props["data-skipped"]).toBe(false);
  expect(findNode(root, (node) => node.props["data-row-key"] === "1")?.props["data-skipped"]).toBe(
    false,
  );
});
