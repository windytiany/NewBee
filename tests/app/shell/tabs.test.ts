import { expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/module/loader";
import { createHostNode, createHostRenderer, findNode } from "../../support/host/renderer";
import { pageNames, pageLabel, type PageName } from "@/app/pages";

const source = await Bun.file(
  new URL("../../../src/app/shell/PageTabs.vue", import.meta.url),
).text();
const { default: PageTabs } = evaluateSource<{ default: Vue.Component }>(
  compileSfc(source, "src/app/shell/PageTabs.vue"),
  { vue: Vue, "@/app/pages": { pageNames, pageLabel } },
);

it("uses flat navigation with a themed underline and preserves page switching", async () => {
  const activePage = Vue.ref<PageName>("Library");
  const renderer = createHostRenderer(createHostNode);
  const root = createHostNode("root");
  const app = renderer.createApp({
    setup: () => () =>
      Vue.h(PageTabs, {
        activePage: activePage.value,
        "onUpdate:activePage": (page: PageName) => {
          activePage.value = page;
        },
      }),
  });
  app.mount(root);
  try {
    const nav = findNode(root, (node) => node.type === "nav");
    expect(nav).not.toBeNull();
    expect(String(nav?.props.class)).not.toMatch(/shadow|rounded|bg-app-/);
    const buttons = nav!.children.filter((node) => node.type === "button");
    expect(buttons).toHaveLength(pageNames.length);
    for (const [index, button] of buttons.entries()) {
      expect(String(button.props.class)).not.toMatch(/shadow|rounded|bg-app-/);
      expect(button.props.class).toContain("focus-visible:outline-2");
      const click = button.props.onClick;
      if (typeof click !== "function") throw new Error("Missing navigation handler");
      click();
      await Vue.nextTick();
      expect(activePage.value).toBe(pageNames[index]!);
      expect(button.props["aria-pressed"]).toBe(true);
      expect(button.props.class).toContain("text-app-accent");
      const indicators = buttons.flatMap((entry) =>
        entry.children.filter((node) => node.type === "span"),
      );
      expect(indicators).toHaveLength(1);
      expect(indicators[0]?.parent).toBe(button);
      expect(indicators[0]?.props.class).toContain("bg-app-accent");
      expect(indicators[0]?.props.class).toContain("bottom-0");
    }
  } finally {
    app.unmount();
  }
});
