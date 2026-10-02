import { describe, expect, it } from "bun:test";
import { createSystemMediaCommandHandler } from "@/playback/systemMedia";

function createHarness() {
  const calls: string[] = [];
  let playing = false;
  let pending = false;
  let canPrevious = true;
  let canNext = true;
  let refresh: () => Promise<boolean> = async () => true;
  const handle = createSystemMediaCommandHandler({
    isCommandPending: () => pending,
    isPlaying: () => playing,
    canPlayPrevious: () => canPrevious,
    canPlayNext: () => canNext,
    refreshStatus: () => refresh(),
    togglePlayback: async () => {
      calls.push("toggle");
      playing = !playing;
      return true;
    },
    playPrevious: async () => {
      calls.push("previous");
      return true;
    },
    playNext: async () => {
      calls.push("next");
      return true;
    },
  });
  return {
    calls,
    handle,
    setPending: (value: boolean) => {
      pending = value;
    },
    setCanPrevious: (value: boolean) => {
      canPrevious = value;
    },
    setCanNext: (value: boolean) => {
      canNext = value;
    },
    setRefresh: (value: () => Promise<boolean>) => {
      refresh = value;
    },
  };
}

describe("Windows system media commands", () => {
  it("treats play and pause as explicit requests instead of blindly toggling", async () => {
    const { handle, calls } = createHarness();
    await handle("pause");
    await handle("play");
    await handle("play");
    await handle("pause");
    await handle("pause");
    expect(calls).toEqual(["toggle", "toggle"]);
  });

  it("toggles playback for tray requests", async () => {
    const { handle, calls } = createHarness();
    await handle("toggle");
    await handle("pause");
    await handle("toggle");
    await handle("play");
    expect(calls).toEqual(["toggle", "toggle", "toggle"]);
  });

  it("does not toggle from the tray when a status refresh fails", async () => {
    const harness = createHarness();
    harness.setRefresh(async () => false);
    await harness.handle("toggle");
    expect(harness.calls).toEqual([]);
  });

  it("routes previous and next through the queue and respects its boundaries", async () => {
    const harness = createHarness();
    await harness.handle("previous");
    await harness.handle("next");
    harness.setCanPrevious(false);
    harness.setCanNext(false);
    await harness.handle("previous");
    await harness.handle("next");
    expect(harness.calls).toEqual(["previous", "next"]);
  });

  it("ignores commands while playback or seeking is busy", async () => {
    const harness = createHarness();
    harness.setPending(true);
    await harness.handle("play");
    await harness.handle("toggle");
    await harness.handle("next");
    expect(harness.calls).toEqual([]);
  });

  it("does not act on a failed status refresh", async () => {
    const harness = createHarness();
    harness.setRefresh(async () => false);
    await harness.handle("play");
    expect(harness.calls).toEqual([]);
  });

  it("ignores overlapping events and resumes handling after completion", async () => {
    const harness = createHarness();
    let resolveRefresh: ((value: boolean) => void) | undefined;
    harness.setRefresh(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const pendingPlay = harness.handle("play");
    await harness.handle("next");
    resolveRefresh?.(true);
    await pendingPlay;
    await harness.handle("next");
    expect(harness.calls).toEqual(["toggle", "next"]);
  });

  it("releases the command guard after a rejected operation", async () => {
    const harness = createHarness();
    harness.setRefresh(async () => {
      throw new Error("Status unavailable");
    });
    await expect(harness.handle("play")).rejects.toThrow("Status unavailable");
    await harness.handle("next");
    expect(harness.calls).toEqual(["next"]);
  });
});
