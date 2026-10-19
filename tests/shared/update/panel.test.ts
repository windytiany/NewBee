import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { createUpdater } from "@/shared/update/controller";
import { setLocale } from "@/shared/i18n/locale";
import { compileSfc, evaluateSource } from "../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../support/host/renderer";

const filename = "src/shared/update/UpdatePanel.vue";
const output = compileSfc(await Bun.file(filename).text(), filename);
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount());
  setLocale("zh-CN");
});

function mount(updater: ReturnType<typeof createUpdater>) {
  const component = evaluateSource<{ default: Vue.Component }>(output, {
    vue: Vue,
    "@/shared/update/runtime": { getUpdater: () => updater },
  }).default;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp(component);
  apps.push(app);
  app.mount(root);
  return root;
}

describe("update panel", () => {
  it("shows check, download progress and restart controls in sequence", async () => {
    let finish!: () => void;
    const events: string[] = [];
    const updater = createUpdater({
      supported: true,
      check: async () => ({
        version: "0.2.0",
        close: async () => {},
        download: async (progress) => {
          progress?.({ event: "Started", data: {} });
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
        install: async () => {
          events.push("install");
        },
      }),
      failed: () => {},
    });
    const root = mount(updater);
    const button = (label: string) => {
      const node = findNode(
        root,
        (node) => node.type === "button" && getTextContent(node) === label,
      );
      if (!node) throw new Error(`Missing button ${label}`);
      return node;
    };
    const click = async (label: string) => {
      const handler = button(label).props.onClick;
      if (typeof handler !== "function") throw new Error("Missing click handler");
      return handler();
    };
    await click("检查更新");
    await Vue.nextTick();
    expect(getTextContent(root)).toContain("发现新版本 0.2.0");
    const section = findNode(root, (node) => node.type === "section")!;
    const controls = findNode(section, (node) => node.type === "div")!;
    const status = findNode(section, (node) => node.props.role === "status")!;
    expect(section.children.indexOf(status)).toBeGreaterThan(section.children.indexOf(controls));
    const buttonClass = String(button("检查更新").props.class);
    expect(String(button("更新").props.class)).toBe(buttonClass);
    expect(buttonClass).toContain("bg-white/10");
    expect(buttonClass).toContain("hover:bg-white/20");
    expect(buttonClass).not.toContain("bg-app-accent");
    const downloading = click("更新");
    await Vue.nextTick();
    expect(button("检查更新").props.disabled).toBe(true);
    expect(findNode(root, (node) => node.type === "progress")?.props.value).toBeUndefined();
    expect(events).toEqual([]);
    finish();
    await downloading;
    await Vue.nextTick();
    expect(String(button("重启并更新").props.class)).toBe(buttonClass);
    expect(findNode(root, (node) => node.type === "progress")).toBeNull();
    setLocale("en");
    await Vue.nextTick();
    expect(getTextContent(root)).toContain("Update ready");
    await click("Restart and update");
    expect(events).toEqual(["install"]);
  });

  it("renders a manual check failure and allows retry", async () => {
    let fail = true;
    const updater = createUpdater({
      supported: true,
      check: async () => {
        if (fail) throw new Error("HTTP 404");
        return null;
      },
      failed: () => {},
    });
    const root = mount(updater);
    await updater.check();
    await Vue.nextTick();
    expect(getTextContent(root)).toContain("检查更新失败，请稍后重试");
    const section = findNode(root, (node) => node.type === "section")!;
    const controls = findNode(section, (node) => node.type === "div")!;
    const error = findNode(section, (node) => node.props.role === "alert")!;
    expect(section.children.indexOf(error)).toBeGreaterThan(section.children.indexOf(controls));
    expect(getTextContent(root)).not.toContain("已是最新版本");
    fail = false;
    await updater.check();
    await Vue.nextTick();
    expect(getTextContent(root)).toContain("已是最新版本");
    expect(findNode(root, (node) => node.props.role === "alert")).toBeNull();
  });

  it("hides native controls in unsupported environments", () => {
    const updater = createUpdater({ supported: false, check: async () => null, failed: () => {} });
    const root = mount(updater);
    expect(findNode(root, (node) => node.type === "button")).toBeNull();
  });
});
