import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import * as Icons from "@lucide/vue";
import { createTaskCenter, taskPercentage } from "@/shared/tasks/state";
import { setLocale } from "@/shared/i18n/locale";
import { compileSfc, evaluateSource } from "../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../support/host/renderer";

const filename = "src/shared/tasks/TaskEntry.vue";
const output = compileSfc(await Bun.file(filename).text(), filename);
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount());
  setLocale("zh-CN");
});

function mount() {
  const tasks = createTaskCenter();
  const component = evaluateSource<{ default: Vue.Component }>(output, {
    vue: Vue,
    "@lucide/vue": Icons,
    "@/shared/tasks/state": { tasks, taskPercentage },
  }).default;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp(component);
  app.mount(root);
  apps.push(app);
  const entry = () =>
    findNode(root, (node) => node.type === "button" && node.props["aria-label"] === "后台任务");
  const panel = () => findNode(root, (node) => node.props.popover === "auto")!;
  function toggle(newState: "open" | "closed") {
    const handler = panel().props.onToggle;
    if (typeof handler !== "function") throw new Error("Missing native popover toggle handler");
    handler({ newState });
  }
  return { tasks, root, entry, panel, toggle };
}

const progress = {
  key: "replaygain-analysis",
  message: "正在分析 ReplayGain…",
  completed: 1260,
  total: 3000,
};

describe("task entry", () => {
  it("hides when idle, starts collapsed, shows a single percentage and uses a native dismissible popover", async () => {
    const test = mount();
    expect(test.entry()).toBeNull();
    test.tasks.update(progress);
    await Vue.nextTick();
    expect(getTextContent(findNode(test.entry()!, (node) => node.type === "span")!)).toBe("42%");
    expect(test.entry()?.props["aria-expanded"]).toBe(false);
    expect(test.entry()?.props.popovertarget).toBe(test.panel().props.id);
    // Native auto popovers provide outside-click/Escape dismissal and focus return.
    expect(test.panel().props.popover).toBe("auto");
    test.toggle("open");
    await Vue.nextTick();
    expect(test.entry()?.props["aria-expanded"]).toBe(true);
    expect(findNode(test.panel(), (node) => node.type === "progress")?.props.value).toBe(1260);
    expect(getTextContent(test.panel())).toContain("1260 / 3000 · 42%");
    expect(
      findNode(test.panel(), (node) => node.type === "button" && getTextContent(node) === "取消"),
    ).toBeNull();
    test.toggle("closed");
    await Vue.nextTick();
    expect(test.entry()?.props["aria-expanded"]).toBe(false);
    expect(test.tasks.active.value).toHaveLength(1);
    test.tasks.finish("replaygain-analysis");
    await Vue.nextTick();
    expect(test.entry()).toBeNull();
  });

  it("counts concurrent tasks rather than averaging their percentages and supports indeterminate cancellation", async () => {
    const test = mount();
    let cancelled = 0;
    const lyrics = { key: "lyrics", message: "歌词下载", completed: 0, cancel: () => cancelled++ };
    test.tasks.update(progress);
    test.tasks.update(lyrics);
    await Vue.nextTick();
    expect(getTextContent(findNode(test.entry()!, (node) => node.type === "span")!)).toBe("2");
    const article = findNode(
      test.panel(),
      (node) => node.type === "article" && getTextContent(node).includes("歌词下载"),
    )!;
    expect(findNode(article, (node) => node.type === "progress")?.props.value).toBeUndefined();
    const cancel = findNode(article, (node) => node.type === "button")!;
    (cancel.props.onClick as () => void)();
    expect(cancelled).toBe(1);
    test.tasks.update({ ...lyrics, cancelling: true });
    await Vue.nextTick();
    expect(cancel.props.disabled).toBe(true);
    expect(getTextContent(cancel)).toBe("正在取消…");
  });

  it("removes a failed task immediately without showing result controls", async () => {
    const test = mount();
    test.tasks.update(progress);
    test.tasks.finish("replaygain-analysis", {
      type: "error",
      message: "ReplayGain 分析失败",
      details: ["未改写原文件"],
    });
    await Vue.nextTick();
    expect(test.entry()).toBeNull();
    expect(test.tasks.items.value).toEqual([]);
  });

  it("keeps only running tasks when a failure arrives while open and translates controls", async () => {
    const test = mount();
    test.tasks.update(progress);
    await Vue.nextTick();
    test.toggle("open");
    test.tasks.update({ key: "scan", message: "扫描", completed: 0 });
    test.tasks.finish("replaygain-analysis", { type: "warning", message: "1 首失败" });
    await Vue.nextTick();
    expect(test.tasks.items.value.map((task) => task.key)).toEqual(["scan"]);
    setLocale("en");
    await Vue.nextTick();
    expect(getTextContent(test.panel())).toContain("Background tasks");
    expect(findNode(test.panel(), (node) => getTextContent(node) === "Clear")).toBeNull();
    expect(getTextContent(test.panel())).not.toContain("1 首失败");
  });
});
