import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";

import { HelpDialog } from "../../../support/help/dialog";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";
import type { NotificationInput } from "@/shared/notifications/center";

const dialogSource = await Bun.file(
  new URL("../../../../src/features/library/paths/PathMigrationDialog.vue", import.meta.url),
).text();

const dialogOutput = compileSfc(
  dialogSource,
  "src/features/library/paths/PathMigrationDialog.vue",
  {
    inlineTemplate: false,
  },
);

type DialogBindings = {
  dialogElement: Vue.Ref<{ open: boolean; showModal: () => void; close: () => void }>;
  oldPath: Vue.Ref<string>;
  newPath: Vue.Ref<string>;
  isMigrating: Vue.Ref<boolean>;
  show: () => void;
  close: () => void;
  migrate: () => Promise<void>;
};

function createDialog(
  invoke: (command: string, args: unknown) => Promise<unknown>,
  isTauriApp = true,
) {
  const notices: NotificationInput[] = [];
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/shared/components/HelpDialog.vue": HelpDialog,
    "@tauri-apps/api/core": { invoke, isTauri: () => isTauriApp },
    "@/shared/notifications/center": {
      notify: (notice: NotificationInput) => notices.push(notice),
    },
  };
  const component = evaluateSource<{
    default: { setup: (props: object, context: object) => DialogBindings };
  }>(dialogOutput, modules).default;
  const bindings = component.setup({}, { expose: () => {} });
  const element = {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };
  bindings.dialogElement.value = element;
  bindings.show();
  bindings.oldPath.value = "C:\\Music\\";
  bindings.newPath.value = "D:\\Music\\";
  return { bindings, element, notices };
}

describe("path migration dialog", () => {
  it("shows the migration form without explanatory help", async () => {
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(dialogSource, "src/features/library/paths/PathMigrationDialog.vue"),
      {
        vue: Vue,
        "@/shared/components/HelpDialog.vue": HelpDialog,
        "@tauri-apps/api/core": { invoke: async () => 0, isTauri: () => true },
        "@/shared/notifications/center": { notify: () => {} },
      },
    ).default;
    const renderer = createHostRenderer<HostNode>((type, text = "") =>
      Object.assign(createHostNode(type, text), {
        open: false,
        value: "",
        tagName: type.toUpperCase(),
        addEventListener: () => {},
        removeEventListener: () => {},
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
        },
      }),
    );
    const root = createHostNode("root");
    const app = renderer.createApp(component);
    const exposed = app.mount(root) as unknown as { show: () => void };
    try {
      exposed.show();
      await Vue.nextTick();
      expect(getTextContent(root)).toContain("原路径");
      expect(getTextContent(root)).toContain("取消");
      expect(findNode(root, (node) => node.props["aria-label"] === "关闭路径迁移")).toBeNull();
      expect(getTextContent(root)).not.toContain("按字面前缀匹配");
      expect(getTextContent(root)).not.toContain("不移动或检查实际文件");
      expect(findNode(root, (node) => node.props["aria-label"] === "路径迁移说明")).toBeNull();
      expect(getTextContent(root)).toContain("新路径");
    } finally {
      app.unmount();
    }
  });

  it("sends both prefixes, reports the count, and closes after success", async () => {
    const calls: unknown[] = [];
    const { bindings, element, notices } = createDialog(async (command, args) => {
      calls.push([command, args]);
      return 12;
    });
    bindings.oldPath.value = " C:\\Music\\ ";
    await bindings.migrate();
    expect(calls).toEqual([
      ["migrate_library_paths", { oldPath: "C:\\Music\\", newPath: "D:\\Music\\" }],
    ]);
    expect(notices[0]?.type).toBe("success");
    expect(notices[0]?.message).toContain("12");
    expect(element.open).toBe(false);
  });

  it("keeps the dialog and input when no tracks match", async () => {
    const { bindings, element, notices } = createDialog(async () => 0);
    await bindings.migrate();
    expect(notices).toEqual([
      { type: "warning", message: "没有匹配原路径的记录", key: "library-path-migration" },
    ]);
    expect(element.open).toBe(true);
    expect(bindings.oldPath.value).toBe("C:\\Music\\");
  });

  it("retains input and permits retry after a backend conflict", async () => {
    let calls = 0;
    const { bindings, element, notices } = createDialog(async () => {
      if (++calls === 1) throw new Error("路径冲突");
      return 1;
    });
    await bindings.migrate();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ type: "error", message: "路径迁移失败" });
    expect(element.open).toBe(true);
    expect(bindings.isMigrating.value).toBe(false);
    expect(bindings.newPath.value).toBe("D:\\Music\\");
    await bindings.migrate();
    expect(element.open).toBe(false);
  });

  it("does not invoke migration for empty or identical prefixes", async () => {
    let calls = 0;
    const { bindings, notices } = createDialog(async () => ++calls);
    bindings.oldPath.value = "  ";
    await bindings.migrate();
    bindings.oldPath.value = bindings.newPath.value;
    await bindings.migrate();
    expect(calls).toBe(0);
    expect(notices).toHaveLength(2);
    expect(
      notices.every(
        ({ type, message }) => type === "warning" && message === "请输入不同且非空的原路径和新路径",
      ),
    ).toBe(true);
  });

  it("blocks duplicate submits, closing and resetting while migration is pending", async () => {
    let resolve!: (count: number) => void;
    let calls = 0;
    const pending = new Promise<number>((finish) => {
      resolve = finish;
    });
    const { bindings, element } = createDialog(() => {
      calls++;
      return pending;
    });
    const migration = bindings.migrate();
    await bindings.migrate();
    bindings.close();
    bindings.show();
    expect(calls).toBe(1);
    expect(element.open).toBe(true);
    expect(bindings.oldPath.value).toBe("C:\\Music\\");
    resolve(2);
    await migration;
    expect(element.open).toBe(false);
  });

  it("cancel does not invoke migration and reopening clears unsaved input", () => {
    let calls = 0;
    const { bindings, element } = createDialog(async () => ++calls);
    bindings.close();
    expect(element.open).toBe(false);
    bindings.show();
    expect(bindings.oldPath.value).toBe("");
    expect(bindings.newPath.value).toBe("");
    expect(calls).toBe(0);
  });

  it("does not invoke desktop APIs in browser preview", async () => {
    let calls = 0;
    const { bindings } = createDialog(async () => ++calls, false);
    await bindings.migrate();
    expect(calls).toBe(0);
  });
});
