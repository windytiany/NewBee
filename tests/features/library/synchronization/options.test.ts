import { expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
  type HostNode,
} from "../../../support/host/renderer";
import type { SynchronizationFolder } from "@/features/library/synchronization/types";

const source = compileSfc(
  await Bun.file("src/features/library/synchronization/SynchronizationOptions.vue").text(),
  "SynchronizationOptions.vue",
);

function mount(initial: SynchronizationFolder[]) {
  const folders = Vue.ref(initial);
  let selected: string | null = null;
  const icon = Vue.defineComponent({ setup: () => () => Vue.h("svg") });
  const component = evaluateSource<{ default: Vue.Component }>(source, {
    vue: Vue,
    "@lucide/vue": { Plus: icon, Minus: icon },
    "@tauri-apps/plugin-dialog": { open: async () => selected },
    "@/shared/notifications/center": { notify: () => {} },
  }).default;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp({
    setup: () => () =>
      Vue.h(
        component,
        {
          modelValue: folders.value,
          "onUpdate:modelValue": (value: SynchronizationFolder[]) => {
            folders.value = value;
          },
        },
        {
          heading: () => Vue.h("h3", { class: "mr-auto" }, "同步文件夹"),
        },
      ),
  });
  app.mount(root);
  return {
    root,
    folders,
    unmount: () => app.unmount(),
    select: (path: string | null) => {
      selected = path;
    },
  };
}

function button(root: HostNode, label: string) {
  return findNode(root, (node) => node.type === "button" && node.props["aria-label"] === label)!;
}
function rows(root: HostNode) {
  return findNode(root, (node) => node.type === "tbody")!.children.filter(
    (node) => node.type === "tr",
  );
}

it("formats paths in a scrollable two-column table with icon-only toolbar controls", () => {
  const paths = [String.raw`\\?\D:\Temp\tempdir`, String.raw`\\?\UNC\server\music`, "/music/local"];
  const test = mount(paths.map((path) => ({ path, enabled: true, mode: "continuous" })));
  const text = getTextContent(test.root);
  expect(text).toContain(String.raw`D:\Temp\tempdir`);
  expect(text).toContain(String.raw`\\server\music`);
  expect(text).not.toContain("\\\\?\\");
  expect(text).not.toContain("监视中");
  expect(text).toContain("无");
  expect(text).not.toContain("启动时扫描一次");
  expect(test.folders.value.map((folder) => folder.path)).toEqual(paths);
  const row = rows(test.root)[0]!;
  expect(row.children.filter((node) => node.type === "td")).toHaveLength(2);
  expect(findNode(row, (node) => node.type === "button")).toBeNull();
  expect(findNode(test.root, (node) => node.type === "input")).toBeNull();
  for (const label of ["添加文件夹", "移除"]) {
    const control = button(test.root, label);
    expect(getTextContent(control)).toBe("");
    expect(findNode(control, (node) => node.type === "svg")).not.toBeNull();
  }
  expect(
    findNode(
      test.root,
      (node) => node.type === "div" && String(node.props.class).includes("overflow-auto"),
    ),
  ).not.toBeNull();
  test.unmount();
});

it("places the title and actions on one line directly above the table", () => {
  const test = mount([]);
  const heading = findNode(test.root, (node) => node.type === "h3")!;
  const toolbar = heading.parent!;
  expect(button(test.root, "添加文件夹").parent).toBe(toolbar);
  expect(button(test.root, "移除").parent).toBe(toolbar);
  expect(String(toolbar.props.class)).toContain("items-center");
  expect(String(heading.props.class)).toContain("mr-auto");
  const container = toolbar.parent!;
  expect(String(container.props.class)).toContain("gap-2");
  expect(container.children.filter((node) => node.type === "div")).toHaveLength(2);
  test.unmount();
});

it("maps None to disabled and restores monitoring through the same dropdown", async () => {
  const path = String.raw`\\?\D:\Music`;
  const test = mount([{ path, enabled: true, mode: "continuous" }]);
  const select = findNode(test.root, (node) => node.type === "select")!;
  (select.props.onChange as (event: unknown) => void)({ target: { value: "none" } });
  await Vue.nextTick();
  expect(test.folders.value[0]).toEqual({ path, enabled: false, mode: "continuous" });
  expect(select.props.value).toBe("none");
  (select.props.onChange as (event: unknown) => void)({ target: { value: "startup" } });
  await Vue.nextTick();
  expect(test.folders.value[0]).toEqual({ path, enabled: true, mode: "startup" });
  (select.props.onChange as (event: unknown) => void)({ target: { value: "continuous" } });
  await Vue.nextTick();
  expect(test.folders.value[0]).toEqual({ path, enabled: true, mode: "continuous" });
  test.unmount();
});

it("displays an already disabled folder as None", () => {
  const test = mount([{ path: "/music", enabled: false, mode: "startup" }]);
  expect(findNode(test.root, (node) => node.type === "select")!.props.value).toBe("none");
  test.unmount();
});

it("removes only the selected record and disables removal when no row is selected", async () => {
  const first: SynchronizationFolder = { path: "/music/first", enabled: true, mode: "startup" };
  const second: SynchronizationFolder = {
    path: "/music/second",
    enabled: false,
    mode: "continuous",
  };
  const test = mount([first, second]);
  const remove = button(test.root, "移除");
  expect(remove.props.disabled).toBe(true);
  (remove.props.onClick as () => void)();
  expect(test.folders.value).toHaveLength(2);
  (rows(test.root)[1]!.props.onClick as () => void)();
  await Vue.nextTick();
  expect(rows(test.root)[1]!.props["aria-selected"]).toBe(true);
  expect(remove.props.disabled).toBe(false);
  (remove.props.onClick as () => void)();
  await Vue.nextTick();
  expect(test.folders.value).toEqual([first]);
  expect(remove.props.disabled).toBe(true);
  test.unmount();
});

it("supports selecting a record through keyboard focus and rejects stale selection", async () => {
  const test = mount([{ path: "/music", enabled: true, mode: "startup" }]);
  (rows(test.root)[0]!.props.onFocusin as () => void)();
  await Vue.nextTick();
  expect(button(test.root, "移除").props.disabled).toBe(false);
  test.folders.value = [];
  await Vue.nextTick();
  expect(button(test.root, "移除").props.disabled).toBe(true);
  test.unmount();
});

it("adds enabled folders and selects the new record without changing the list on cancellation", async () => {
  const test = mount([]);
  test.select("D:/Music");
  await (button(test.root, "添加文件夹").props.onClick as () => Promise<void>)();
  await Vue.nextTick();
  expect(test.folders.value).toEqual([{ path: "D:/Music", mode: "manual", enabled: true }]);
  expect(rows(test.root)[0]!.props["aria-selected"]).toBe(true);
  test.select(null);
  await (button(test.root, "添加文件夹").props.onClick as () => Promise<void>)();
  await Vue.nextTick();
  expect(test.folders.value).toHaveLength(1);
  test.unmount();
});
