import { afterEach, describe, expect, it } from "bun:test";
import { createLyricsConfirmation } from "@/features/lyrics/download/confirmation";
import type { LyricsConfirmationOptions } from "@/features/lyrics/download/confirmation";
import type { LyricsDownloadTarget } from "@/features/lyrics/types";

import { notifications } from "@/shared/notifications/center";

afterEach(() => notifications.clear());

const targets: LyricsDownloadTarget[] = [
  { id: 1, title: "Missing", artist: "Artist", hasLyrics: false, noLyrics: false },
  { id: 2, title: "Existing", artist: "Artist", hasLyrics: true, noLyrics: false },
  { id: 3, title: "Instrumental", artist: "Artist", hasLyrics: false, noLyrics: true },
];
function setup(overrides: Partial<LyricsConfirmationOptions> = {}) {
  const started: number[][] = [];
  const loaded: number[][] = [];
  const confirmation = createLyricsConfirmation({
    targets: async (ids) => {
      loaded.push(ids);
      return targets.filter(({ id }) => ids.includes(id));
    },
    loadAlbum: async () => [1, 2, 3, 1],
    running: () => false,
    start: async (ids) => {
      started.push(ids);
    },
    ...overrides,
  });
  return { confirmation, started, loaded };
}

describe("lyrics download confirmation", () => {
  it("loads database status and selects only missing lyrics without starting a download", async () => {
    const { confirmation, started, loaded } = setup();
    await confirmation.openTracks([1, 2, 3, 1]);
    expect(loaded).toEqual([[1, 2, 3]]);
    expect(confirmation.state.selected).toEqual([1]);
    expect(started).toEqual([]);
    await confirmation.confirm();
    expect(started).toEqual([[1]]);
    expect(confirmation.state.open).toBe(false);
  });
  it("allows explicit overwriting of existing and marked tracks, with no second status check", async () => {
    const { confirmation, started, loaded } = setup();
    await confirmation.openTracks([1, 2, 3]);
    confirmation.select(1, false);
    confirmation.select(2, true);
    confirmation.select(3, true);
    await confirmation.confirm();
    expect(started).toEqual([[2, 3]]);
    expect(loaded).toHaveLength(1);
  });
  it("supports album expansion, select all, deselect all and a disabled empty selection", async () => {
    const { confirmation, started } = setup();
    await confirmation.openAlbum({ album: "Album", albumArtist: "Artist" });
    confirmation.selectAll(false);
    expect(confirmation.canConfirm.value).toBe(false);
    await confirmation.confirm();
    expect(started).toEqual([]);
    confirmation.selectAll(true);
    await confirmation.confirm();
    expect(started).toEqual([[1, 2, 3]]);
  });
  it("does not start when cancelled and ignores late status responses", async () => {
    let resolve!: (value: LyricsDownloadTarget[]) => void;
    const request = new Promise<LyricsDownloadTarget[]>((done) => {
      resolve = done;
    });
    const { confirmation, started } = setup({ targets: () => request });
    const opening = confirmation.openTracks([1, 2, 3]);
    await Promise.resolve();
    confirmation.close();
    resolve(targets);
    await opening;
    expect(confirmation.state.open).toBe(false);
    expect(confirmation.state.targets).toEqual([]);
    expect(started).toEqual([]);
  });
  it("reports invalid target responses and prevents starting", async () => {
    const { confirmation, started } = setup({ targets: async () => [targets[0]!, targets[0]!] });
    await confirmation.openTracks([1, 2]);
    expect(confirmation.state.error).toContain("不匹配");
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.message).toBe("读取歌词下载目标失败，请查看日志");
    await confirmation.confirm();
    expect(started).toEqual([]);
  });
  it("cannot open while another batch is running", async () => {
    const { confirmation, loaded } = setup({ running: () => true });
    await confirmation.openTracks([1]);
    expect(confirmation.state.open).toBe(false);
    expect(loaded).toEqual([]);
  });
});
