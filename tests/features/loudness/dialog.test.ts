import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { setLocale } from "@/shared/i18n/locale";
import { createLoudnessConfirmation } from "@/features/loudness/confirmation";
import { compileSfc, evaluateSource } from "../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../support/host/renderer";
import type { HostNode } from "../../support/host/renderer";

const apps: Vue.App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  setLocale("zh-CN");
});
interface DialogNode extends HostNode {
  children: DialogNode[];
  parent: DialogNode | null;
  open: boolean;
  showModal: () => void;
  close: () => void;
}
function node(type: string, text = ""): DialogNode {
  return {
    ...createHostNode(type, text),
    children: [],
    parent: null,
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };
}
const output = compileSfc(
  await Bun.file("src/features/loudness/ConfirmationDialog.vue").text(),
  "ConfirmationDialog.vue",
);
async function mount(title = "恢复原始响度", message = "移除所选曲目的 ReplayGain 标签？") {
  const confirmation = createLoudnessConfirmation();
  const component = evaluateSource<{ default: Vue.Component }>(output, {
    vue: Vue,
    "@/features/loudness/confirmation": { useLoudnessConfirmation: () => confirmation },
  }).default;
  const root = node("root");
  const app = createHostRenderer(node).createApp(component);
  app.mount(root);
  apps.push(app);
  const pending = confirmation.ask(title, message);
  await Vue.nextTick();
  await Vue.nextTick();
  const dialog = findNode(root, (entry) => entry.type === "dialog")!;
  const button = (text: string) =>
    findNode(root, (entry) => entry.type === "button" && getTextContent(entry).trim() === text)!;
  return { app, root, dialog, button, confirmation, pending };
}
it("shows an application modal with a warning and explicitly confirms restoration", async () => {
  const context = await mount();
  expect(context.dialog.open).toBe(true);
  expect(context.dialog.props["aria-describedby"]).toBe("loudness-confirmation-message");
  expect(getTextContent(context.root)).toContain("移除所选曲目的 ReplayGain 标签？");
  expect(context.button("取消").props.autofocus).toBeDefined();
  (context.button("确认").props.onClick as () => void)();
  expect(await context.pending).toBe(true);
  await Vue.nextTick();
  await Vue.nextTick();
  expect(context.dialog.open).toBe(false);
});
for (const dismissal of ["cancel", "escape", "backdrop", "unmount"] as const) {
  it(`cancels analysis through ${dismissal} without accepting the operation`, async () => {
    const context = await mount("分析响度", "重新测量并覆盖所选曲目的 ReplayGain 标签？");
    if (dismissal === "cancel") (context.button("取消").props.onClick as () => void)();
    if (dismissal === "escape")
      (context.dialog.props.onCancel as (event: unknown) => void)({ preventDefault() {} });
    if (dismissal === "backdrop")
      (context.dialog.props.onClick as (event: unknown) => void)({
        target: context.dialog,
        currentTarget: context.dialog,
      });
    if (dismissal === "unmount") {
      apps.splice(apps.indexOf(context.app), 1);
      context.app.unmount();
    }
    expect(await context.pending).toBe(false);
    expect(context.confirmation.state.value).toBeNull();
  });
}
it("updates the operation title and warning when the application locale changes", async () => {
  const context = await mount();
  setLocale("en");
  await Vue.nextTick();
  expect(getTextContent(context.root)).toContain("Restore original loudness");
  expect(getTextContent(context.root)).toContain(
    "Remove ReplayGain tags from the selected tracks?",
  );
  expect(context.button("Confirm")).toBeDefined();
  expect(context.button("Cancel")).toBeDefined();
  (context.button("Cancel").props.onClick as () => void)();
  expect(await context.pending).toBe(false);
});
