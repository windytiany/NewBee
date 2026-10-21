import { cleanupEditor } from "../../support/settings/editor";
import { afterEach, describe, expect, it } from "bun:test";
import { createEditor, defaults } from "../../support/settings/editor";

import type { Settings } from "@/features/settings/types";

describe("settings playback", () => {
  it("loads and saves independent ReplayGain playback and opt-in scan preferences", async () => {
    let saved: Settings | undefined;
    const { bindings } = createEditor(async (command, args) => {
      if (command === "get_settings")
        return { ...defaults, replayGain: false, scanReplayGain: true };
      saved = (args as { settings: Settings }).settings;
    });
    await bindings.show();
    expect(bindings.draft.replayGain).toBe(false);
    expect(bindings.draft.scanReplayGain).toBe(true);
    bindings.draft.replayGain = true;
    bindings.draft.scanReplayGain = false;
    await bindings.save();
    expect(saved?.replayGain).toBe(true);
    expect(saved?.scanReplayGain).toBe(false);
  });

  it("defaults legacy preamp to zero and keeps changes as a draft until saving", async () => {
    const saved: Settings[] = [];
    let persisted: Partial<Settings> = { ...defaults, replayGainPreamp: -3.5 };
    const { bindings } = createEditor(async (command, args) => {
      if (command === "get_settings") return persisted;
      saved.push((args as { settings: Settings }).settings);
    });
    await bindings.show();
    expect(bindings.draft.replayGainPreamp).toBe(-3.5);
    bindings.draft.replayGainPreamp = 6;
    expect(saved).toEqual([]);
    bindings.close();
    await bindings.show();
    expect(bindings.draft.replayGainPreamp).toBe(-3.5);
    bindings.draft.replayGain = false;
    await bindings.save();
    expect(saved[0]).toMatchObject({ replayGain: false, replayGainPreamp: -3.5 });
    persisted = { ...defaults, replayGainPreamp: undefined };
    await bindings.show();
    expect(bindings.draft.replayGainPreamp).toBe(0);
    bindings.draft.replayGainPreamp = 20;
    await bindings.save();
    expect(saved[1]?.replayGainPreamp).toBe(20);
  });

  for (const value of [NaN, Infinity, -Infinity, -20.5, 20.5, 0.25, ""]) {
    it(`rejects invalid preamp ${String(value)} before saving`, async () => {
      let saves = 0;
      const { bindings, feedback, element } = createEditor(async (command) => {
        if (command === "get_settings") return defaults;
        saves++;
      });
      await bindings.show();
      Reflect.set(bindings.draft, "replayGainPreamp", value);
      await bindings.save();
      expect(saves).toBe(0);
      expect(element.open).toBe(true);
      expect(feedback[feedback.length - 1]?.key).toBe("settings-replay-gain-preamp");
    });
  }
});

afterEach(cleanupEditor);
