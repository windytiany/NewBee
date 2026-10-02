import { createRenderer } from "vue";
import type { RendererOptions } from "vue";

export type HostTree<Node> = {
  props: Record<string, unknown>;
  children: Node[];
  parent: Node | null;
  text: string;
};
export interface HostNode extends HostTree<HostNode> {
  type: string;
}

export function createHostNode(type: string, text = ""): HostNode {
  return { type, props: {}, children: [], parent: null, text };
}

export function insertNode<Node extends HostTree<Node>>(
  node: Node,
  parent: Node,
  anchor: Node | null = null,
) {
  removeNode(node);
  node.parent = parent;
  const index = anchor ? parent.children.indexOf(anchor) : -1;
  if (index < 0) parent.children.push(node);
  else parent.children.splice(index, 0, node);
}

export function removeNode<Node extends HostTree<Node>>(node: Node) {
  if (!node.parent) return;
  const index = node.parent.children.indexOf(node);
  if (index >= 0) node.parent.children.splice(index, 1);
  node.parent = null;
}

/** Scene-specific node capabilities and host operations stay with the caller. */
export function createHostRenderer<Node extends HostTree<Node>>(
  createNode: (type: string, text?: string) => Node,
  overrides: Partial<RendererOptions<Node, Node>> = {},
) {
  return createRenderer<Node, Node>({
    patchProp: (node, key, _previous, next) => {
      node.props[key] = next;
    },
    insert: insertNode,
    remove: removeNode,
    createElement: (type) => createNode(type),
    createText: (text) => createNode("#text", text),
    createComment: (text) => createNode("#comment", text),
    setText: (node, text) => {
      node.text = text;
    },
    setElementText: (node, text) => {
      node.text = text;
      node.children = [];
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    ...overrides,
  });
}

export function findNode<Node extends HostTree<Node>>(
  root: Node,
  predicate: (node: Node) => boolean,
): Node | null {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

export function visit<Node extends HostTree<Node>>(node: Node, action: (node: Node) => void) {
  action(node);
  for (const child of node.children) visit(child, action);
}

export function getTextContent<Node extends HostTree<Node>>(node: Node): string {
  return node.text + node.children.map(getTextContent).join("");
}
