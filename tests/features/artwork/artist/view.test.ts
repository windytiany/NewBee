import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import { createHostNode, createHostRenderer, findNode } from "../../../support/host/renderer";

const source = await Bun.file("src/features/artists/ArtistRow.vue").text();
const apps: Vue.App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});
function mountRow(initial: string | null, url: Vue.Ref<string | null>) {
  const names: Array<string | null> = [];
  const artist = Vue.ref(initial);
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "ArtistRow.vue"),
    {
      vue: Vue,
      "@lucide/vue": {
        UserRound: Vue.defineComponent({
          setup: () => () => Vue.h("svg", { "data-icon": "artist" }),
        }),
      },
      "@/features/artwork/artist/usePhoto": {
        usePhoto: (name: () => string | null) => {
          Vue.watch(name, (value) => names.push(value), { immediate: true });
          return { url };
        },
      },
    },
  ).default;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp({
    setup: () => () =>
      Vue.h(component, {
        artist: artist.value,
        name: artist.value ?? "未知演出者",
        albumCount: 1,
        isSelected: false,
        isFocused: false,
      }),
  });
  app.mount(root);
  apps.push(app);
  return { root, names, artist };
}

it("shows a circular artist photo in the sidebar without adding photo actions", async () => {
  const url = Vue.ref<string | null>(null);
  const row = mountRow("Artist", url);
  await Vue.nextTick();
  expect(row.names).toEqual([null, "Artist"]);
  expect(findNode(row.root, (node) => node.props["data-icon"] === "artist")).not.toBeNull();
  url.value = "blob:photo";
  await Vue.nextTick();
  const image = findNode(row.root, (node) => node.type === "img");
  expect(image?.props.src).toBe("blob:photo");
  expect(image?.props.class).toContain("object-cover");
  expect(image?.parent?.props.class).toContain("rounded-full");
  expect(findNode(row.root, (node) => "onContextmenu" in node.props)).toBeNull();
  expect(findNode(row.root, (node) => node.props.role === "menu")).toBeNull();
});

it("shows the icon for unknown artists and for a failed image", async () => {
  const url = Vue.ref<string | null>(null);
  const row = mountRow(null, url);
  expect(row.names).toEqual([null]);
  expect(findNode(row.root, (node) => node.props["data-icon"] === "artist")).not.toBeNull();
  url.value = "blob:bad";
  await Vue.nextTick();
  const image = findNode(row.root, (node) => node.type === "img");
  (image?.props.onError as () => void)();
  await Vue.nextTick();
  expect(findNode(row.root, (node) => node.type === "img")).toBeNull();
  expect(findNode(row.root, (node) => node.props["data-icon"] === "artist")).not.toBeNull();
  url.value = "blob:replacement";
  await Vue.nextTick();
  expect(findNode(row.root, (node) => node.type === "img")?.props.src).toBe("blob:replacement");
});
