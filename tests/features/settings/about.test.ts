import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import config from "../../../src-tauri/tauri.conf.json";
import { setLocale } from "@/shared/i18n/locale";
import type { NotificationInput } from "@/shared/notifications/center";
import { compileSfc, evaluateSource } from "../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../support/host/renderer";

const filename = "src/features/settings/AboutPanel.vue";
const source = await Bun.file(filename).text();

function mountPanel(desktop = true, open: (url: string) => Promise<void> = async () => {}) {
  const feedback: NotificationInput[] = [];
  const component = evaluateSource<{ default: Vue.Component }>(compileSfc(source, filename), {
    vue: Vue,
    "@tauri-apps/api/core": { isTauri: () => desktop },
    "@tauri-apps/plugin-opener": { openUrl: open },
    "../../../src-tauri/tauri.conf.json": config,
    "../../../src-tauri/icons/128x128.png": "/app.png",
    "@/shared/notifications/center": { notify: (input: NotificationInput) => feedback.push(input) },
  }).default;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp(component);
  app.mount(root);
  return { root, app, feedback };
}

afterEach(() => setLocale("zh-CN"));

describe("settings about", () => {
  it("shows the application logo, configured version, author and repository in both locales", async () => {
    const { root, app } = mountPanel();
    try {
      expect(findNode(root, (node) => node.type === "img")?.props).toMatchObject({
        src: "/app.png",
        alt: "NewBee",
      });
      expect(findNode(root, (node) => node.type === "button")).toBeNull();
      expect(getTextContent(root)).toContain(config.version);
      expect(getTextContent(root)).toContain("windytiany");
      expect(getTextContent(root)).toContain("https://github.com/windytiany/NewBee");
      for (const [locale, labels] of [
        ["zh-CN", ["版本", "作者", "仓库"]],
        ["en", ["Version", "Author", "Repository"]],
      ] as const) {
        setLocale(locale);
        await Vue.nextTick();
        for (const label of labels) expect(getTextContent(root)).toContain(label);
      }
    } finally {
      app.unmount();
    }
  });

  it("opens the repository externally on desktop and reports failures", async () => {
    const opened: string[] = [];
    let fail = false;
    const { root, app, feedback } = mountPanel(true, async (url) => {
      if (fail) throw new Error("open failed");
      opened.push(url);
    });
    try {
      const link = findNode(root, (node) => node.type === "a")!;
      expect(link.props.href).toBe("https://github.com/windytiany/NewBee");
      const click = link.props.onClick;
      if (typeof click !== "function") throw new Error("Missing repository handler");
      let prevented = 0;
      const event = { preventDefault: () => prevented++ };
      await click(event);
      expect(prevented).toBe(1);
      expect(opened).toEqual(["https://github.com/windytiany/NewBee"]);
      fail = true;
      await click(event);
      expect(feedback[0]).toMatchObject({ type: "error", message: "打开仓库失败" });
    } finally {
      app.unmount();
    }
  });

  it("keeps the native repository link available outside desktop", async () => {
    const { root, app } = mountPanel(false, async () => {
      throw new Error("Desktop opener must not be used");
    });
    try {
      const link = findNode(root, (node) => node.type === "a")!;
      expect(link.props.target).toBe("_blank");
      expect(link.props.rel).toBe("noopener noreferrer");
      const click = link.props.onClick;
      if (typeof click !== "function") throw new Error("Missing repository handler");
      await click({
        preventDefault: () => {
          throw new Error("Native link must not be blocked");
        },
      });
    } finally {
      app.unmount();
    }
  });
});
