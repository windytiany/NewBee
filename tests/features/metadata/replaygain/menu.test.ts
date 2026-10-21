import { expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";

for (const [componentName, operation, title, progress] of [
  ["AnalysisMenuItem", "analyze", "分析 ReplayGain", "正在分析 ReplayGain…"],
  ["RemovalMenuItem", "remove", "移除 ReplayGain 标签", "正在移除 ReplayGain 标签…"],
] as const) {
  const path = `src/features/metadata/replaygain/${componentName}.vue`;
  const output = compileSfc(await Bun.file(path).text(), path);
  it(`${operation} captures selected targets before closing and disables empty or busy actions`, async () => {
    const pending = Vue.ref(false);
    const disabled = Vue.ref(false);
    const calls: Array<{ operation: string; ids: number[]; paths: string[] }> = [];
    const ids = Vue.ref([7, 9]);
    const paths = Vue.ref(["/music/temporary.flac"]);
    const record = (operation: string) => (targets: number[], files: string[]) => {
      calls.push({ operation, ids: targets, paths: files });
    };
    const { default: component } = evaluateSource<{ default: Vue.Component }>(output, {
      vue: Vue,
      "@/features/metadata/replaygain/useReplayGain": {
        useReplayGain: () => ({ pending, analyze: record("analyze"), remove: record("remove") }),
      },
    });
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp({
      setup: () => () =>
        Vue.h(component, {
          trackIds: ids.value,
          paths: paths.value,
          disabled: disabled.value,
          onClose: () => {
            ids.value = [];
            paths.value = [];
          },
        }),
    });
    app.mount(root);
    try {
      const button = findNode(root, (node) => node.type === "button")!;
      const click = () =>
        (button.props.onClick as (event: unknown) => void)({ stopPropagation() {} });
      expect(getTextContent(root)).toBe(title);
      click();
      expect(calls).toEqual([{ operation, ids: [7, 9], paths: ["/music/temporary.flac"] }]);
      await Vue.nextTick();
      expect(button.props.disabled).toBe(true);
      click();
      expect(calls).toHaveLength(1);
      ids.value = [7];
      pending.value = true;
      await Vue.nextTick();
      expect(button.props.disabled).toBe(true);
      expect(getTextContent(root)).toBe(progress);
      click();
      expect(calls).toHaveLength(1);
      pending.value = false;
      disabled.value = true;
      await Vue.nextTick();
      click();
      expect(calls).toHaveLength(1);
    } finally {
      app.unmount();
    }
  });
}
