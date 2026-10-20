import { expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/module/loader";
import type { NotificationInput } from "@/shared/notifications/center";

const filename = "src/shared/logging/DiagnosticsPanel.vue";
const source = await Bun.file(
  new URL("../../../src/shared/logging/DiagnosticsPanel.vue", import.meta.url),
).text();
const output = compileSfc(source, filename, {
  id: "diagnostic-export-test",
  inlineTemplate: false,
});
type Bindings = {
  exportDiagnostics: () => Promise<void>;
  exporting: Vue.Ref<boolean>;
  level: Vue.Ref<string>;
  module: Vue.Ref<string>;
  operationId: Vue.Ref<string>;
  since: Vue.Ref<string>;
  until: Vue.Ref<string>;
  allSessions: Vue.Ref<boolean>;
  includeContext: Vue.Ref<boolean>;
  anonymizePaths: Vue.Ref<boolean>;
};
function fixture(
  pick: () => Promise<string | null> = async () => "D:/diagnostics.jsonl",
  execute: () => Promise<unknown> = async () => ({ records: 2, omitted: 0 }),
) {
  const requests: Array<{ command: string; args: unknown }> = [];
  const feedback: NotificationInput[] = [];
  const component = evaluateSource<{
    default: { setup: (props: object, context: object) => Bindings };
  }>(output, {
    vue: Vue,
    "@tauri-apps/plugin-dialog": { save: pick },
    "@tauri-apps/api/core": {
      invoke: async (command: string, args: unknown) => {
        requests.push({ command, args });
        return execute();
      },
    },
    "@/shared/notifications/center": { notify: (input: NotificationInput) => feedback.push(input) },
  }).default;
  return { bindings: component.setup({}, { expose: () => {} }), requests, feedback };
}

it("exports warning records with privacy enabled by default", async () => {
  const { bindings, requests, feedback } = fixture();
  await bindings.exportDiagnostics();
  expect(requests).toEqual([
    {
      command: "export_diagnostics",
      args: {
        destination: "D:/diagnostics.jsonl",
        options: {
          level: "WARN",
          module: null,
          operationId: null,
          since: null,
          until: null,
          allSessions: false,
          includeContext: false,
          anonymizePaths: true,
        },
      },
    },
  ]);
  expect(feedback[0]?.message).toBe("诊断已导出");
  expect(bindings.exporting.value).toBe(false);
});

it("passes selected filters without help text or placeholders", async () => {
  const { bindings, requests } = fixture();
  bindings.level.value = "ERROR";
  bindings.module.value = " library ";
  bindings.operationId.value = " scan:1 ";
  bindings.since.value = "2026-01-01T12:00";
  bindings.until.value = "2026-01-01T13:00";
  bindings.allSessions.value = true;
  bindings.includeContext.value = true;
  bindings.anonymizePaths.value = false;
  await bindings.exportDiagnostics();
  expect(requests[0]?.args).toMatchObject({
    options: {
      level: "ERROR",
      module: "library",
      operationId: "scan:1",
      since: new Date(bindings.since.value).getTime(),
      until: new Date(bindings.until.value).getTime(),
      allSessions: true,
      includeContext: true,
      anonymizePaths: false,
    },
  });
  expect(source).not.toContain("placeholder=");
  expect(source).not.toContain("tooltip");
});

it("cancels silently and ignores concurrent requests while the picker is pending", async () => {
  let finish!: (path: string | null) => void;
  let picks = 0;
  const { bindings, requests, feedback } = fixture(() => {
    picks++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const pending = bindings.exportDiagnostics();
  await bindings.exportDiagnostics();
  expect(picks).toBe(1);
  finish(null);
  await pending;
  expect(requests).toHaveLength(0);
  expect(feedback).toHaveLength(0);
  expect(bindings.exporting.value).toBe(false);
});

it("reports export failures and releases the pending state", async () => {
  const { bindings, feedback } = fixture(undefined, async () => {
    throw new Error("D:/private/logs\nstack");
  });
  await bindings.exportDiagnostics();
  expect(feedback[0]).toMatchObject({ type: "error", message: "导出诊断失败" });
  expect(bindings.exporting.value).toBe(false);
});
