import { afterEach, describe, expect, it } from "bun:test";
import { h, nextTick } from "vue";
import { HelpDialog } from "../../support/helpDialog";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../support/hostRenderer";
import type { HostNode } from "../../support/hostRenderer";

interface HelpNode extends HostNode {
  children: HelpNode[];
  parent: HelpNode | null;
  open: boolean;
  showModal: () => void;
  close: () => void;
}

function createNode(type: string, text = ""): HelpNode {
  const node: HelpNode = {
    ...createHostNode(type, text),
    children: [],
    parent: null,
    open: false,
    showModal: () => {
      node.open = true;
    },
    close: () => {
      node.open = false;
    },
  };
  return node;
}

const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});

function mountHelp() {
  const root = createNode("root");
  const app = createHostRenderer(createNode).createApp({
    setup: () => () =>
      h("dialog", { id: "editor" }, [
        h(HelpDialog, { label: "操作说明" }, () => h("p", "按需显示的帮助内容")),
        h(HelpDialog, { label: "其他说明" }, () => h("p", "其他帮助内容")),
      ]),
  });
  app.mount(root);
  apps.push(app);
  return root;
}

function node(root: HelpNode, predicate: (node: HelpNode) => boolean) {
  const result = findNode(root, predicate);
  if (!result) throw new Error("Missing help node");
  return result;
}

function click(target: HelpNode) {
  const handler = target.props.onClick;
  if (typeof handler !== "function") throw new Error("Missing click handler");
  handler();
}

async function settle() {
  await nextTick();
  await nextTick();
}

describe("info help", () => {
  it("hides explanations until clicked and closes only the help dialog", async () => {
    const root = mountHelp();
    const editor = node(root, (entry) => entry.props.id === "editor");
    editor.open = true;
    const trigger = node(root, (entry) => entry.props["aria-label"] === "操作说明");
    expect(trigger.props.type).toBe("button");
    expect(trigger.props["aria-haspopup"]).toBe("dialog");
    expect(trigger.props["aria-expanded"]).toBe(false);
    expect(getTextContent(root)).not.toContain("帮助内容");
    click(trigger);
    click(trigger);
    await settle();
    const help = node(root, (entry) => entry.props.id === trigger.props["aria-controls"]);
    expect(help.open).toBe(true);
    expect(editor.open).toBe(true);
    expect(getTextContent(help)).toContain("按需显示的帮助内容");
    expect(trigger.props["aria-expanded"]).toBe(true);
    click(node(help, (entry) => entry.props["aria-label"] === "关闭说明"));
    await settle();
    expect(help.open).toBe(false);
    expect(editor.open).toBe(true);
    expect(trigger.props["aria-expanded"]).toBe(false);
    expect(getTextContent(root)).not.toContain("帮助内容");

    click(trigger);
    await settle();
    const reopened = node(root, (entry) => entry.props.id === trigger.props["aria-controls"]);
    const cancel = reopened.props.onCancel;
    if (typeof cancel !== "function") throw new Error("Missing cancel handler");
    let prevented = false;
    cancel({
      preventDefault() {
        prevented = true;
      },
    });
    await settle();
    expect(prevented).toBe(true);
    expect(reopened.open).toBe(false);
    expect(editor.open).toBe(true);
  });

  it("uses distinct accessible IDs for multiple help buttons", async () => {
    const root = mountHelp();
    const first = node(root, (entry) => entry.props["aria-label"] === "操作说明");
    const second = node(root, (entry) => entry.props["aria-label"] === "其他说明");
    click(first);
    click(second);
    await settle();
    expect(first.props["aria-controls"]).not.toBe(second.props["aria-controls"]);
    for (const trigger of [first, second]) {
      const help = node(root, (entry) => entry.props.id === trigger.props["aria-controls"]);
      const title = node(help, (entry) => entry.props.id === help.props["aria-labelledby"]);
      expect(getTextContent(title)).toBe(trigger.props["aria-label"] as string);
    }
  });
});
