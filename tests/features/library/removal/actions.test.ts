import { describe, expect, it } from "bun:test";
import { createLibraryHarness } from "../../../support/library/browser";

const harness = await createLibraryHarness();

describe("library album removal", () => {
  const selection = { albumArtist: "Other artist", album: "Other album" };

  it("deletes every album track and cleans the queue with one library refresh", async () => {
    harness.availableTracks = [harness.track, harness.secondTrack, harness.thirdTrack];
    const page = harness.mountLibraryPage();
    await harness.settleRequests();

    const result = await page.removeAlbumFromLibrary(selection);

    expect(result).toEqual({ completed: true, deletedCount: 3, message: "" });
    expect(page.trackActionMessage.value).toBe("");
    expect(harness.databaseDeleteCalls).toEqual([
      harness.track.id,
      harness.secondTrack.id,
      harness.thirdTrack.id,
    ]);
    expect(harness.queueRemovalCalls).toEqual([
      harness.track.id,
      harness.secondTrack.id,
      harness.thirdTrack.id,
    ]);
    expect(harness.invokeCalls.filter((command) => command === "list_artists")).toHaveLength(2);
  });

  it("clears playback and the entire queue when deleting the active track's album", async () => {
    harness.availableTracks = [harness.track, harness.secondTrack, harness.thirdTrack];
    harness.mockedCurrentTrack.value = {
      trackId: harness.secondTrack.id,
      title: harness.secondTrack.title,
      artist: "Artist",
    };
    const page = harness.mountLibraryPage();
    await harness.settleRequests();

    const result = await page.removeAlbumFromLibrary(selection);

    expect(result).toEqual({ completed: true, deletedCount: 3, message: "" });
    expect(harness.clearQueueCalls).toBe(1);
    expect(harness.queueRemovalCalls).toEqual([]);
    expect(harness.databaseDeleteCalls).toEqual([
      harness.track.id,
      harness.secondTrack.id,
      harness.thirdTrack.id,
    ]);
  });

  it("reports zero deletions accurately and allows retrying the failed album", async () => {
    harness.availableTracks = [harness.track, harness.secondTrack];
    harness.databaseDeleteFailures.set(harness.track.id, new Error("database busy"));
    harness.databaseDeleteFailures.set(harness.secondTrack.id, new Error("database busy"));
    const page = harness.mountLibraryPage();
    await harness.settleRequests();
    const result = await page.removeAlbumFromLibrary(selection);
    expect(result.completed).toBe(false);
    expect(result.deletedCount).toBe(0);
    expect(result.message).toBe("已从曲库移除 0 首，2 首移除失败");
    expect(page.trackActionRemoval.value).toEqual({
      deletedCount: 0,
      failedCount: 2,
      queueSyncFailed: false,
    });
    expect(harness.queueRemovalCalls).toEqual([]);
    harness.databaseDeleteFailures.clear();
    const retried = await page.removeAlbumFromLibrary(selection);
    expect(retried).toEqual({ completed: true, deletedCount: 2, message: "" });
    expect(page.trackActionRemoval.value).toEqual({
      deletedCount: 2,
      failedCount: 0,
      queueSyncFailed: false,
    });
  });

  it("reports partial deletion and continues deleting the remaining tracks", async () => {
    harness.availableTracks = [harness.track, harness.secondTrack, harness.thirdTrack];
    harness.databaseDeleteFailures.set(harness.secondTrack.id, new Error("database busy"));
    const page = harness.mountLibraryPage();
    await harness.settleRequests();

    const result = await page.removeAlbumFromLibrary(selection);

    expect(result.completed).toBe(false);
    expect(result.deletedCount).toBe(2);
    expect(page.trackActionRemoval.value).toEqual({
      deletedCount: 2,
      failedCount: 1,
      queueSyncFailed: false,
    });
    expect(page.trackActionMessage.value).toBe("已从曲库删除 2 首曲目。");
    expect(result.message).toBe("已从曲库移除 2 首，1 首移除失败");
    expect(harness.queueRemovalCalls).toEqual([harness.track.id, harness.thirdTrack.id]);
  });

  it("reports a fetch failure without modifying the queue or database", async () => {
    const page = harness.mountLibraryPage();
    await harness.settleRequests();
    harness.albumTracksError = new Error("database unavailable");

    expect(await page.addAlbumToNext(selection)).toBe(false);
    expect((await page.removeAlbumFromLibrary(selection)).completed).toBe(false);
    expect(harness.queueNextBatchCalls).toEqual([]);
    expect(harness.databaseDeleteCalls).toEqual([]);
    expect(page.trackActionError.value).toBe("从曲库删除专辑失败");
    expect(page.isTrackActionPending.value).toBe(false);
  });
  it("shares the action lock with queue additions and single-track removal", async () => {
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);
    let resolve!: (tracks: typeof harness.availableTracks) => void;
    harness.albumTracksResponse = new Promise((done) => {
      resolve = done;
    });

    const removal = page.removeAlbumFromLibrary(selection);
    expect(page.isTrackActionPending.value).toBe(true);
    expect(await page.addTracksToQueueEnd([harness.track.id])).toBe(false);
    expect(await page.removeTrackFromLibrary(harness.track.id)).toMatchObject({
      status: "not-deleted",
    });
    expect(harness.databaseDeleteCalls).toEqual([]);
    expect(harness.queueEndBatchCalls).toEqual([]);

    resolve([harness.track]);
    expect(await removal).toEqual({ completed: true, deletedCount: 1, message: "" });
    expect(page.isTrackActionPending.value).toBe(false);
    expect(page.trackActionRemoval.value).toEqual({
      deletedCount: 1,
      failedCount: 0,
      queueSyncFailed: false,
    });
    harness.albumTracksResponse = null;
    expect(await page.addAlbumToNext(selection)).toBe(false);
    expect(page.trackActionRemoval.value).toBeNull();
  });

  it("retains successful index deletion when clearing active playback fails", async () => {
    harness.availableTracks = [harness.track, harness.secondTrack];
    harness.mockedCurrentTrack.value = {
      trackId: harness.track.id,
      title: "Song",
      artist: "Artist",
    };
    harness.queueRemovalError = new Error("queue persistence failed");
    const page = harness.mountLibraryPage();
    await harness.settleRequests();

    expect(await page.removeAlbumFromLibrary(selection)).toEqual({
      completed: false,
      deletedCount: 2,
      message: "已从曲库移除 2 首，队列同步失败",
    });
    expect(harness.clearQueueCalls).toBe(1);
    expect(harness.databaseDeleteCalls).toEqual([harness.track.id, harness.secondTrack.id]);
    expect(page.trackActionRemoval.value).toEqual({
      deletedCount: 2,
      failedCount: 0,
      queueSyncFailed: true,
    });
    expect(page.isTrackActionPending.value).toBe(false);
    expect(harness.invokeCalls.filter((command) => command === "list_artists")).toHaveLength(2);
  });
});

describe("library track removal", () => {
  it("keeps deletion failure separate and does not clean the playback queue", async () => {
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);
    harness.databaseDeleteError = new Error("database unavailable");

    const result = await page.removeTrackFromLibrary(harness.track.id);

    expect(result).toEqual({
      status: "not-deleted",
      message: "从曲库移除失败",
    });
    expect(harness.queueRemovalCalls).toEqual([]);
    expect(
      harness.invokeCalls.filter((command) => command === "remove_track_from_library"),
    ).toHaveLength(1);
    expect(page.trackActionError.value).toBe("从曲库移除失败");
    expect(harness.invokeCalls.filter((command) => command === "list_artists")).toHaveLength(1);
  });

  it("treats a missing queue row as a complete deletion", async () => {
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);

    const result = await page.removeTrackFromLibrary(harness.track.id);

    expect(result).toEqual({ status: "deleted" });
    expect(harness.queueRemovalCalls).toEqual([harness.track.id]);
    expect(
      harness.invokeCalls.filter((command) => command === "remove_track_from_library"),
    ).toHaveLength(1);
    expect(harness.invokeCalls.filter((command) => command === "list_artists")).toHaveLength(2);
    expect(page.trackActionError.value).toBe("");
  });

  it("returns a partial-success warning after a current-track stop failure", async () => {
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);
    harness.queueRemovalResult = { status: "stop-failed", message: "device busy" };

    const result = await page.removeTrackFromLibrary(harness.track.id);

    expect(result).toEqual({
      status: "deleted-queue-sync-failed",
      issue: "stop-failed",
      message: "曲库索引已删除，但停止当前播放失败：device busy",
    });
    expect(page.trackActionError.value).toBe("曲库索引已删除，但停止当前播放失败：device busy");
    expect(harness.queueRemovalCalls).toEqual([harness.track.id]);
    expect(
      harness.invokeCalls.filter((command) => command === "remove_track_from_library"),
    ).toHaveLength(1);
    expect(harness.invokeCalls.filter((command) => command === "list_artists")).toHaveLength(2);
  });

  it("does not report queue exceptions as stop failures", async () => {
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);
    harness.queueRemovalError = new Error("queue persistence failed");

    const result = await page.removeTrackFromLibrary(harness.track.id);

    expect(result).toMatchObject({
      status: "deleted-queue-sync-failed",
      issue: "queue-error",
    });
    expect(page.trackActionError.value).toContain("播放队列同步失败：queue persistence failed");
    expect(
      harness.invokeCalls.filter((command) => command === "remove_track_from_library"),
    ).toHaveLength(1);
  });

  it("does not report superseded cleanup as a stop failure", async () => {
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);
    harness.queueRemovalResult = { status: "superseded" };

    const result = await page.removeTrackFromLibrary(harness.track.id);

    expect(result).toMatchObject({
      status: "deleted-queue-sync-failed",
      issue: "superseded",
    });
    expect(page.trackActionError.value).toContain("被较新的播放操作取代");
    expect(
      harness.invokeCalls.filter((command) => command === "remove_track_from_library"),
    ).toHaveLength(1);
  });
  it("keeps an unconfirmed stop distinct from deletion failure", async () => {
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);
    harness.queueRemovalResult = { status: "stop-unconfirmed" };
    expect(await page.removeTrackFromLibrary(harness.track.id)).toEqual({
      status: "deleted-queue-sync-failed",
      issue: "stop-unconfirmed",
      message: "曲库索引已删除，但无法确认当前播放已停止，未推进下一首。",
    });
    expect(page.trackActionRemoval.value).toEqual({
      deletedCount: 1,
      failedCount: 0,
      queueSyncFailed: true,
    });
    expect(page.isTrackActionPending.value).toBe(false);
  });
});
