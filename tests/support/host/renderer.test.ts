import { afterEach, describe, expect, it } from "bun:test";
import { defineComponent, h, nextTick, onUnmounted, ref, watch } from "vue";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
  insertNode,
  removeNode,
  visit,
} from "./renderer";

const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});

describe("test host renderer", () => {
  it("moves existing nodes between parents and inserts before an anchor without duplicates", () => {
    const first = createHostNode("first");
    const second = createHostNode("second");
    const moving = createHostNode("moving");
    const anchor = createHostNode("anchor");
    insertNode(moving, first);
    insertNode(anchor, second);
    insertNode(moving, second, anchor);
    expect(first.children).toEqual([]);
    expect(second.children).toEqual([moving, anchor]);
    expect(moving.parent).toBe(second);
    insertNode(moving, second);
    expect(second.children).toEqual([anchor, moving]);
    removeNode(moving);
    removeNode(moving);
    expect(second.children).toEqual([anchor]);
    expect(moving.parent).toBeNull();
  });

  it("patches props and text and preserves node identity during keyed reordering", async () => {
    const ids = ref([1, 2, 3]);
    const label = ref("before");
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp({
      setup: () => () =>
        h(
          "ul",
          ids.value.map((id) => h("li", { key: id, id }, `${label.value}:${id}`)),
        ),
    });
    app.mount(root);
    apps.push(app);
    const list = root.children[0]!;
    const firstRow = list.children[0]!;
    ids.value = [3, 1, 2];
    label.value = "after";
    await nextTick();
    expect(list.children.map((node) => node.props.id)).toEqual([3, 1, 2]);
    expect(list.children[1]).toBe(firstRow);
    expect(getTextContent(firstRow)).toBe("after:1");
    ids.value = [3, 2];
    await nextTick();
    expect(firstRow.parent).toBeNull();
    expect(list.children.map((node) => node.props.id)).toEqual([3, 2]);
  });

  it("finds nodes and traverses their tree in source order", () => {
    const root = createHostNode("root");
    const branch = createHostNode("branch", "a");
    const leaf = createHostNode("leaf", "b");
    insertNode(branch, root);
    insertNode(leaf, branch);
    expect(findNode(root, (node) => node.type === "leaf")).toBe(leaf);
    expect(findNode(root, (node) => node.type === "missing")).toBeNull();
    const types: string[] = [];
    visit(root, (node) => types.push(node.type));
    expect(types).toEqual(["root", "branch", "leaf"]);
    expect(getTextContent(root)).toBe("ab");
  });

  it("unmounts component effects and detaches the rendered tree", async () => {
    const value = ref(0);
    const changes: number[] = [];
    let unmounts = 0;
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp(
      defineComponent({
        setup() {
          watch(value, (next) => changes.push(next));
          onUnmounted(() => unmounts++);
          return () => h("p", String(value.value));
        },
      }),
    );
    app.mount(root);
    apps.push(app);
    const paragraph = root.children[0]!;
    value.value = 1;
    await nextTick();
    expect(changes).toEqual([1]);
    app.unmount();
    apps.splice(apps.indexOf(app), 1);
    value.value = 2;
    await nextTick();
    expect(changes).toEqual([1]);
    expect(unmounts).toBe(1);
    expect(root.children).toEqual([]);
    expect(paragraph.parent).toBeNull();
  });
});
