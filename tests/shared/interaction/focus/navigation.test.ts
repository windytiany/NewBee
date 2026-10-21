import { afterEach, expect, it } from "bun:test";
import { usePageFocus } from "@/app/usePageFocus";
import { createHostNode, createHostRenderer } from "../../../support/host/renderer";

const originals = new Map(
  ["document", "HTMLElement", "Element"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
class FocusNode {
  children: FocusNode[] = [];
  parent: FocusNode | null = null;
  isConnected = true;
  hidden = false;
  disabled = false;
  tabIndex: number;
  attributes: Record<string, string> = {};
  constructor(
    readonly tagName: string,
    readonly document: FocusDocument,
    attributes: Record<string, string> = {},
  ) {
    this.attributes = attributes;
    this.tabIndex = tagName === "BUTTON" || tagName === "INPUT" ? 0 : -1;
  }
  append(...children: FocusNode[]) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
    return this;
  }
  contains(node: unknown): boolean {
    return this === node || this.children.some((child) => child.contains(node));
  }
  getClientRects(): object[] {
    return this.hidden || this.parent?.getClientRects().length === 0 ? [] : [{}];
  }
  hasAttribute(name: string) {
    return name in this.attributes;
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  closest(selector: string): FocusNode | null {
    return this.matches(selector) ? this : (this.parent?.closest(selector) ?? null);
  }
  matches(selector: string): boolean {
    if (selector === ":disabled" || selector.includes("aria-disabled")) return this.disabled;
    if (selector.includes(","))
      return selector.split(",").some((part) => this.matches(part.trim()));
    if (selector === "dialog[open]") return this.tagName === "DIALOG" && this.hasAttribute("open");
    if (selector === '[role="menu"]') return this.attributes.role === "menu";
    if (selector.startsWith("button["))
      return this.tagName === "BUTTON" && this.matches(selector.slice(6));
    const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attribute)
      return attribute[2] === undefined
        ? this.hasAttribute(attribute[1]!)
        : this.getAttribute(attribute[1]!) === attribute[2];
    return selector.toUpperCase() === this.tagName;
  }
  querySelectorAll(selector: string): FocusNode[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  blur() {
    if (this.document.activeElement === this) this.document.activeElement = this.document.body;
  }
  focus() {
    this.document.activeElement = this;
    const event = new Event("focusin");
    Object.defineProperty(event, "target", { value: this });
    this.document.dispatchEvent(event);
  }
}
class FocusDocument extends EventTarget {
  readonly body = new FocusNode("BODY", this);
  activeElement: FocusNode = this.body;
  querySelectorAll(selector: string) {
    return this.body.querySelectorAll(selector);
  }
  querySelector(selector: string) {
    return this.body.querySelector(selector);
  }
}
function mount() {
  const document = new FocusDocument();
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: FocusNode });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: FocusNode });
  const node = (tag: string, attributes: Record<string, string> = {}) =>
    new FocusNode(tag, document, attributes);
  const library = node("DIV", { "data-page": "Library" });
  const sidebar = node("SECTION", { "data-focus-region": "" });
  const dropdown = node("BUTTON");
  const artists = node("UL", { "data-keyboard-list": "" });
  const artist = node("BUTTON", { "data-keyboard-item": "" });
  artists.append(artist);
  sidebar.append(dropdown, artists);
  const browser = node("SECTION", { "data-focus-region": "" });
  const albums = node("DIV", { "data-keyboard-list": "" });
  const firstAlbum = node("BUTTON", { "data-keyboard-item": "" });
  const lastAlbum = node("BUTTON", { "data-keyboard-item": "" });
  albums.append(firstAlbum, lastAlbum);
  browser.append(albums);
  const hiddenRegion = node("SECTION", { "data-focus-region": "" });
  hiddenRegion.hidden = true;
  hiddenRegion.append(node("BUTTON"));
  const playback = node("SECTION", { "data-focus-region": "" }).append(node("BUTTON"));
  library.append(sidebar, browser);
  document.body.append(library, hiddenRegion, playback);
  const app = createHostRenderer(createHostNode).createApp({
    setup() {
      usePageFocus();
      return () => null;
    },
  });
  app.mount(createHostNode("root"));
  apps.push(app);
  function press(key: string, shiftKey = false, overrides: Record<string, unknown> = {}) {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, {
      key,
      code: key,
      shiftKey,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      isComposing: false,
      repeat: false,
      ...overrides,
    });
    Object.defineProperty(event, "target", { value: document.activeElement });
    document.dispatchEvent(event);
    return event;
  }
  return {
    document,
    app,
    node,
    sidebar,
    dropdown,
    artists,
    artist,
    browser,
    albums,
    firstAlbum,
    lastAlbum,
    playback,
    press,
  };
}

it("moves from the sidebar dropdown to the browser with F6 and restores each region's last focus", () => {
  const h = mount();
  h.dropdown.focus();
  expect(h.press("F6").defaultPrevented).toBe(true);
  expect(h.document.activeElement).toBe(h.firstAlbum);
  h.lastAlbum.focus();
  h.press("F6", true);
  expect(h.document.activeElement).toBe(h.dropdown);
  h.artist.focus();
  h.press("F6");
  expect(h.document.activeElement).toBe(h.lastAlbum);
  h.press("F6");
  expect(h.document.activeElement).toBe(h.playback.children[0]);
  h.press("F6");
  expect(h.document.activeElement).toBe(h.artist);
});

it("clears F6 focus with Escape and allows region navigation to resume", () => {
  const h = mount();
  h.dropdown.focus();
  h.press("F6");
  expect(h.press("Escape").defaultPrevented).toBe(true);
  expect(h.document.activeElement).toBe(h.document.body);
  expect(h.press("Escape").defaultPrevented).toBe(false);
  h.press("F6");
  expect(h.document.activeElement).toBe(h.dropdown);
});

it("leaves ordinary focus, modified Escape and open menus or dialogs alone", () => {
  const h = mount();
  h.dropdown.focus();
  expect(h.press("Escape").defaultPrevented).toBe(false);
  expect(h.document.activeElement).toBe(h.dropdown);
  h.press("F6");
  for (const overrides of [{ ctrlKey: true }, { shiftKey: true }, { isComposing: true }]) {
    expect(h.press("Escape", false, overrides).defaultPrevented).toBe(false);
    expect(h.document.activeElement).toBe(h.firstAlbum);
  }
  for (const container of [h.node("DIALOG", { open: "" }), h.node("DIV", { role: "menu" })]) {
    h.document.body.append(container);
    expect(h.press("Escape").defaultPrevented).toBe(false);
    expect(h.document.activeElement).toBe(h.firstAlbum);
    container.hidden = true;
  }
  const input = h.node("INPUT");
  h.browser.append(input);
  input.focus();
  expect(h.press("Escape").defaultPrevented).toBe(false);
  expect(h.document.activeElement).toBe(input);
});

it("repairs a missing list Tab entry before native Tab moves from the dropdown to the items", () => {
  const h = mount();
  h.artist.tabIndex = -1;
  h.firstAlbum.tabIndex = -1;
  h.lastAlbum.tabIndex = -1;
  const dragHandle = h.node("BUTTON", { "data-item-interaction": "" });
  dragHandle.tabIndex = -1;
  dragHandle.parent = h.albums;
  h.albums.children.unshift(dragHandle);
  h.dropdown.focus();
  expect(h.press("Tab").defaultPrevented).toBe(false);
  expect(dragHandle.tabIndex).toBe(-1);
  expect(h.artist.tabIndex).toBe(0);
  const next = h.sidebar.querySelectorAll("button").filter((element) => element.tabIndex >= 0)[1];
  expect(next).toBe(h.artist);
  expect([h.firstAlbum, h.lastAlbum].filter((element) => element.tabIndex === 0)).toHaveLength(1);
});

it("replaces invalid remembered targets and enters newly loaded lists instead of their empty region", () => {
  const h = mount();
  h.lastAlbum.focus();
  h.lastAlbum.disabled = true;
  h.press("F6", true);
  h.press("F6");
  expect(h.document.activeElement).toBe(h.firstAlbum);
  h.albums.children = [];
  h.dropdown.focus();
  h.press("F6");
  expect(h.document.activeElement).toBe(h.browser);
  const loadedAlbum = h.node("BUTTON", { "data-keyboard-item": "" });
  h.albums.append(loadedAlbum);
  h.press("F6", true);
  h.press("F6");
  expect(h.document.activeElement).toBe(loadedAlbum);
});

it("detaches region navigation on unmount and does not repeat F6 while held", () => {
  const h = mount();
  h.dropdown.focus();
  expect(h.press("F6", false, { repeat: true }).defaultPrevented).toBe(true);
  expect(h.document.activeElement).toBe(h.dropdown);
  h.app.unmount();
  apps.splice(apps.indexOf(h.app), 1);
  expect(h.press("F6").defaultPrevented).toBe(false);
  expect(h.document.activeElement).toBe(h.dropdown);
});

it("does not steal keys from menus, dialogs, IME or other modified shortcuts", () => {
  const h = mount();
  const input = h.node("INPUT");
  h.sidebar.append(input);
  input.focus();
  h.press("F6");
  expect(h.document.activeElement).toBe(h.firstAlbum);
  for (const container of [h.node("DIALOG", { open: "" }), h.node("DIV", { role: "menu" })]) {
    h.document.body.append(container.append(h.node("BUTTON")));
    container.children[0]!.focus();
    expect(h.press("F6").defaultPrevented).toBe(false);
    expect(h.document.activeElement).toBe(container.children[0]);
    container.hidden = true;
    delete container.attributes.open;
    delete container.attributes.role;
  }
  h.dropdown.focus();
  expect(h.press("F6", false, { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(h.press("F6", false, { isComposing: true }).defaultPrevented).toBe(false);
});
