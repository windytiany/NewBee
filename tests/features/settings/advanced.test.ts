import { cleanupEditor } from "../../support/settings/editor";
import { afterEach, describe, expect, it } from "bun:test";
import { createEditor, defaults } from "../../support/settings/editor";

import type { Settings } from "@/features/settings/types";

describe("settings advanced", () => {
  it("loads startup checks and persists the user's choice", async () => {
    let persisted: Settings = { ...defaults, checkUpdatesOnStartup: true };
    const { bindings } = createEditor(async (command, args) => {
      if (command === "get_settings") return persisted;
      if (command === "save_settings") persisted = (args as { settings: Settings }).settings;
    });
    await bindings.show();
    expect(bindings.draft.checkUpdatesOnStartup).toBe(true);
    bindings.draft.checkUpdatesOnStartup = false;
    await bindings.save();
    expect(persisted.checkUpdatesOnStartup).toBe(false);
    await bindings.show();
    expect(bindings.draft.checkUpdatesOnStartup).toBe(false);
    bindings.draft.checkUpdatesOnStartup = true;
    bindings.close();
    await bindings.show();
    expect(bindings.draft.checkUpdatesOnStartup).toBe(false);
  });

  it("opens only the app log directory and switches detail immediately without persisting it", async () => {
    const calls: Array<[string, unknown]> = [];
    const { bindings } = createEditor(async (command, args) => {
      calls.push([command, args]);
      return defaults;
    });
    await bindings.show();
    await bindings.diagnostics.openLogs();
    bindings.diagnostics.detailedLogging.value = true;
    await bindings.diagnostics.changeLogging();
    expect(calls).toEqual([
      ["get_settings", undefined],
      ["open_logs_directory", undefined],
      ["set_detailed_logging", { enabled: true }],
    ]);
    await bindings.save();
    expect(calls[calls.length - 1]).toEqual(["save_settings", { settings: defaults }]);
    expect(JSON.stringify(calls[calls.length - 1])).not.toContain("detailedLogging");
    expect(createEditor(async () => defaults).bindings.diagnostics.detailedLogging.value).toBe(
      false,
    );
  });

  it("notifies diagnostic failures, rolls back the toggle and permits another operation", async () => {
    let fail = true;
    const { bindings, feedback } = createEditor(async (command) => {
      if (command === "get_settings") return defaults;
      if (fail) throw new Error("permission denied");
    });
    await bindings.show();
    await bindings.diagnostics.openLogs();
    expect(feedback[feedback.length - 1]).toMatchObject({
      type: "error",
      message: "打开日志目录失败",
    });
    bindings.diagnostics.detailedLogging.value = true;
    await bindings.diagnostics.changeLogging();
    expect(bindings.diagnostics.detailedLogging.value).toBe(false);
    expect(feedback[feedback.length - 1]).toMatchObject({
      type: "error",
      message: "切换日志级别失败",
    });
    expect(bindings.diagnostics.isChangingLogging.value).toBe(false);
    fail = false;
    bindings.diagnostics.detailedLogging.value = true;
    await bindings.diagnostics.changeLogging();
    expect(bindings.diagnostics.detailedLogging.value).toBe(true);
  });
});

afterEach(cleanupEditor);
