import { cleanupEditor } from "../../support/settings/editor";
import { afterEach, describe, expect, it } from "bun:test";
import { createEditor, defaults } from "../../support/settings/editor";

import type { Settings } from "@/features/settings/types";

describe("settings library", () => {
  it("keeps synchronization folders as a draft and saves the shared configuration without starting a scan", async () => {
    const persisted: Settings = {
      ...defaults,
      synchronizationFolders: [{ path: "D:/Music", mode: "startup", enabled: true }],
    };
    const calls: string[] = [];
    let saved: Settings | undefined;
    const { bindings } = createEditor(async (command, args) => {
      calls.push(command);
      if (command === "get_settings") return persisted;
      if (command === "save_settings") saved = (args as { settings: Settings }).settings;
    });
    await bindings.show();
    bindings.selectedCategory.value = "library";
    bindings.draft.synchronizationFolders[0]!.mode = "continuous";
    expect(persisted.synchronizationFolders[0]!.mode).toBe("startup");
    bindings.close();
    await bindings.show();
    expect(bindings.draft.synchronizationFolders).toEqual(persisted.synchronizationFolders);
    bindings.draft.synchronizationFolders = [
      { path: "D:/Other", mode: "continuous", enabled: false },
    ];
    await bindings.save();
    expect(saved?.synchronizationFolders).toEqual([
      { path: "D:/Other", mode: "continuous", enabled: false },
    ]);
    expect(calls).not.toContain("save_synchronization_folders");
    expect(calls).not.toContain("synchronize_library");
  });

  for (const enabled of [false, true]) {
    it(`persists statistics visibility ${enabled}`, async () => {
      const saved: unknown[] = [];
      const { bindings } = createEditor(async (command, args) => {
        if (command === "get_settings") return defaults;
        saved.push(args);
      });
      await bindings.show();
      bindings.draft.showPlaybackStatistics = enabled;
      await bindings.save();
      expect(saved).toEqual([{ settings: { ...defaults, showPlaybackStatistics: enabled } }]);
    });
  }
});

afterEach(cleanupEditor);
