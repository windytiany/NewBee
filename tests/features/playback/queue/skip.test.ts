import { afterEach, expect, it } from "bun:test";
import { setLocale } from "@/shared/i18n/locale";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";

import { createHostNode, createHostRenderer, findNode } from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";

const source = await Bun.file("src/features/playback/queue/components/QueueList.vue").text();
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  setLocale("zh-CN");
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

it("maps multi-selected queue occurrences to global track IDs and synchronizes skip indicators", async () => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { lang: "zh-CN" }, addEventListener() {}, removeEventListener() {} },
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
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "src/features/playback/queue/components/QueueList.vue"),
    {
      vue: Vue,
      "@/shared/interaction/item/useSelection": {
        useItemSelection: () => ({
          isSelected: () => true,
          isFocused: () => false,
          syncVisibleItems: () => {},
          contextMenuTargets: (_rowKey: string, keys: string[]) => keys,
        }),
      },
      "@/shared/notifications/useNotification": { useNotification: () => {} },
      "@/features/tracks/format": { formatTrackDuration: () => "1:00" },
      "@/features/playback/queue/components/QueueRow.vue": row,
      "@/features/metadata/manual/components/EditMenuItem.vue": menu,
      "@/features/tracks/presentation/RereadMenuItem.vue": Vue.defineComponent({
        props: ["trackIds"],
        setup: (props) => () =>
          Vue.h("button", { "data-reread-targets": JSON.stringify(props.trackIds) }),
      }),
      "@/features/playback/queue/components/SkipMenuItem.vue": menu,
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
  const heading = findNode(root, (node) => node.type === "section")!;
  expect(heading.props["aria-label"]).toBe("当前曲目列表");
  setLocale("en");
  await Vue.nextTick();
  expect(heading.props["aria-label"]).toBe("Current track list");
  setLocale("zh-CN");
  await Vue.nextTick();
  expect(heading.props["aria-label"]).toBe("当前曲目列表");
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
  expect(
    findNode(root, (node) => node.props["data-reread-targets"] !== undefined)?.props[
      "data-reread-targets"
    ],
  ).toBe("[7,7,8]");
  skippedIds.value = [];
  await Vue.nextTick();
  expect(first.props["data-skipped"]).toBe(false);
  expect(findNode(root, (node) => node.props["data-row-key"] === "1")?.props["data-skipped"]).toBe(
    false,
  );
});
