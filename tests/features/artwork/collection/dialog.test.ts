import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";
const source = await Bun.file("src/features/artwork/collection/AdditionDialog.vue").text();
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});
function mount() {
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "AdditionDialog.vue"),
    { vue: Vue },
  ).default;
  const root = createHostNode("root");
  const props = Vue.reactive({ working: false });
  const confirmed: string[] = [];
  let cancelled = 0;
  let opened = 0;
  let closed = 0;
  const app = createHostRenderer<HostNode>((type, text) => ({
    ...createHostNode(type, text),
    showModal: () => {
      opened++;
    },
    close: () => {
      closed++;
    },
  })).createApp({
    setup: () => () =>
      Vue.h(component, {
        ...props,
        url: "blob:preview",
        path: "D:/selected.png",
        onConfirm: (value: string) => confirmed.push(value),
        onCancel: () => {
          cancelled++;
        },
      }),
  });
  app.mount(root);
  apps.push(app);
  return {
    root,
    props,
    confirmed,
    app,
    get cancelled() {
      return cancelled;
    },
    get opened() {
      return opened;
    },
    get closed() {
      return closed;
    },
  };
}
function node(root: HostNode, predicate: (entry: HostNode) => boolean) {
  const result = findNode(root, predicate);
  if (!result) throw new Error("Missing addition dialog control");
  return result;
}
function submit(root: HostNode) {
  (node(root, (entry) => entry.type === "form").props.onSubmit as (event: object) => void)({
    preventDefault() {},
  });
}
function choose(root: HostNode, value: string) {
  (node(root, (entry) => entry.props.value === value).props.onChange as () => void)();
}
describe("addition confirmation dialog", () => {
  it("opens a modal with preview, source path and no selected storage", () => {
    const scene = mount();
    expect(scene.opened).toBe(1);
    expect(node(scene.root, (entry) => entry.type === "img").props.src).toBe("blob:preview");
    expect(node(scene.root, (entry) => entry.props.readonly !== undefined).props.value).toBe(
      "D:/selected.png",
    );
    expect(node(scene.root, (entry) => entry.props.value === "embedded").props.checked).toBe(false);
    expect(node(scene.root, (entry) => entry.props.value === "linked").props.checked).toBe(false);
    expect(node(scene.root, (entry) => entry.props.type === "submit").props.disabled).toBe(true);
    submit(scene.root);
    expect(scene.confirmed).toEqual([]);
    expect(getTextContent(scene.root)).not.toContain("folder.jpg");
    expect(getTextContent(scene.root)).not.toContain("评论");
    scene.app.unmount();
    expect(scene.closed).toBe(1);
  });
  it("uses mutually exclusive choices and form submission for keyboard confirmation", async () => {
    const { root, confirmed } = mount();
    choose(root, "embedded");
    await Vue.nextTick();
    expect(node(root, (entry) => entry.props.type === "submit").props.disabled).toBe(false);
    expect(node(root, (entry) => entry.props.value === "embedded").props.checked).toBe(true);
    choose(root, "linked");
    await Vue.nextTick();
    expect(node(root, (entry) => entry.props.value === "embedded").props.checked).toBe(false);
    expect(node(root, (entry) => entry.props.value === "linked").props.checked).toBe(true);
    submit(root);
    expect(confirmed).toEqual(["linked"]);
  });
  it("stops Escape propagation and cancels only when not submitting", async () => {
    const scene = mount();
    const dialog = node(scene.root, (entry) => entry.type === "dialog");
    let stopped = 0;
    let prevented = 0;
    (dialog.props.onKeydown as (event: object) => void)({
      key: "Escape",
      stopPropagation() {
        stopped++;
      },
    });
    expect(stopped).toBe(1);
    (dialog.props.onCancel as (event: object) => void)({
      preventDefault() {
        prevented++;
      },
      stopPropagation() {
        stopped++;
      },
    });
    expect(prevented).toBe(1);
    expect(scene.cancelled).toBe(1);
    choose(scene.root, "embedded");
    scene.props.working = true;
    await Vue.nextTick();
    submit(scene.root);
    (dialog.props.onCancel as (event: object) => void)({
      preventDefault() {},
      stopPropagation() {},
    });
    (
      node(scene.root, (entry) => entry.type === "button" && getTextContent(entry) === "取消").props
        .onClick as () => void
    )();
    expect(scene.confirmed).toEqual([]);
    expect(scene.cancelled).toBe(1);
    expect(node(scene.root, (entry) => entry.props.type === "submit").props.disabled).toBe(true);
    expect(node(scene.root, (entry) => entry.type === "fieldset").props.disabled).toBe(true);
  });
});
