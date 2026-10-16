import { afterEach, expect, it, mock } from "bun:test";
import * as Vue from "vue";
import { usePageFocus } from "@/app/usePageFocus";
import type { PageName } from "@/app/pages";
import { createHostNode, createHostRenderer } from "../support/host/renderer";

const originals = new Map(
  ["document", "HTMLElement"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
class FocusElement {
  isConnected = true;
  visible = true;
  children: FocusElement[] = [];
  readonly focus = mock(() => {});
  constructor(readonly page: PageName) {}
  closest(selector: string) {
    return selector === `[data-page="${this.page}"]` ? this : null;
  }
  contains(target: unknown) {
    return this === target || this.children.includes(target as FocusElement);
  }
  querySelectorAll() {
    return this.children;
  }
  getClientRects() {
    return this.visible ? [{}] : [];
  }
  matches() {
    return false;
  }
}
it("restores page-specific focus, falls back for stale targets and does not steal dialog focus", async () => {
  const roots = {
    Library: new FocusElement("Library"),
    Playlist: new FocusElement("Playlist"),
    Inbox: new FocusElement("Inbox"),
    Playing: new FocusElement("Playing"),
  };
  const libraryFirst = new FocusElement("Library");
  const libraryLast = new FocusElement("Library");
  const playlistFirst = new FocusElement("Playlist");
  roots.Library.children.push(libraryFirst, libraryLast);
  roots.Playlist.children.push(playlistFirst);
  let dialogOpen = false;
  const document = Object.assign(new EventTarget(), {
    querySelector: (selector: string) => {
      if (selector === "dialog[open]") return dialogOpen ? {} : null;
      return (
        Object.entries(roots).find(([page]) => selector === `[data-page="${page}"]`)?.[1] ?? null
      );
    },
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: FocusElement });
  const activePage = Vue.ref<PageName>("Library");
  const app = createHostRenderer(createHostNode).createApp({
    setup() {
      usePageFocus(activePage);
      return () => null;
    },
  });
  app.mount(createHostNode("root"));
  apps.push(app);
  const event = new Event("focusin");
  Object.defineProperty(event, "target", { value: libraryLast });
  document.dispatchEvent(event);
  activePage.value = "Playlist";
  await Vue.nextTick();
  await Vue.nextTick();
  expect(playlistFirst.focus).toHaveBeenCalledTimes(1);
  activePage.value = "Library";
  await Vue.nextTick();
  await Vue.nextTick();
  expect(libraryLast.focus).toHaveBeenCalledTimes(1);
  libraryLast.isConnected = false;
  activePage.value = "Playlist";
  await Vue.nextTick();
  await Vue.nextTick();
  activePage.value = "Library";
  await Vue.nextTick();
  await Vue.nextTick();
  expect(libraryFirst.focus).toHaveBeenCalledTimes(1);
  dialogOpen = true;
  activePage.value = "Playlist";
  await Vue.nextTick();
  await Vue.nextTick();
  expect(playlistFirst.focus).toHaveBeenCalledTimes(2);
});
