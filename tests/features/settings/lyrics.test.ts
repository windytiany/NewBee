import { cleanupEditor } from "../../support/settings/editor";
import { afterEach, describe, expect, it } from "bun:test";
import { createEditor, defaults } from "../../support/settings/editor";

describe("settings lyrics", () => {
  it("persists disabled lyric providers", async () => {
    const saved: unknown[] = [];
    const { bindings } = createEditor(async (command, args) => {
      if (command === "get_settings") return defaults;
      saved.push(args);
    });
    await bindings.show();
    bindings.draft.lyricsProviders = [];
    await bindings.save();
    expect(saved).toEqual([{ settings: { ...defaults, lyricsProviders: [] } }]);
  });
});

afterEach(cleanupEditor);
