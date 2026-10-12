import type { MetadataTarget } from "@/features/metadata/types";
import { describe, expect, it } from "bun:test";
import { createMetadataSave } from "@/features/metadata/save";
import { playbackFixture } from "../../support/playback/session";
import type { MetadataSaveResult } from "@/features/metadata/types";

function result(trackId: MetadataTarget, success = true): MetadataSaveResult {
  return {
    trackId,
    path: `/music/${trackId}.mp3`,
    fileWritten: success,
    databaseUpdated: success,
    error: success ? null : "文件只读",
  };
}
function targets(...ids: MetadataTarget[]) {
  return ids.map((trackId) => ({ trackId, path: `/music/${trackId}.mp3` }));
}
function fixture(paused = false, canStop = true) {
  const synchronized: MetadataTarget[][] = [];
  const { session, calls } = playbackFixture({ paused, canStop });
  const save = createMetadataSave({
    editFiles: session.withMetadataEditing,
    synchronize: (ids) => {
      synchronized.push(ids);
    },
  });
  const queue = [1, 2].map((trackId) => ({
    trackId,
    rowKey: `row:${trackId}`,
    title: "Song",
    album: "Album",
    durationMs: 1000,
  }));
  return { save, session, calls, queue, synchronized };
}

describe("track metadata save", () => {
  for (const paused of [false, true]) {
    it(`releases ${paused ? "paused" : "playing"} audio before writing and synchronizes without restarting`, async () => {
      const { save, session, queue, calls, synchronized } = fixture(paused);
      await session.playTracks(queue, "row:1");
      const saved = await save.run({
        targets: targets(1),
        writeTrackIds: [1],
        execute: async (progress) => {
          expect(session.state.currentPlaybackId.value).toBeNull();
          expect(session.state.isPlaybackCommandPending.value).toBe(true);
          calls.push("write");
          progress(result(1));
          return [result(1)];
        },
      });
      expect(saved).toEqual([result(1)]);
      expect(calls.indexOf("beginEditing")).toBeLessThan(calls.indexOf("write"));
      expect(calls.filter((command) => command === "playTracks")).toHaveLength(1);
      expect(session.state.currentRowKey.value).toBe("row:1");
      expect(session.state.displayedTracks.value.map(({ rowKey }) => rowKey)).toEqual([
        "row:1",
        "row:2",
      ]);
      expect(session.state.isPlaybackCommandPending.value).toBe(false);
      expect(synchronized).toEqual([[1]]);
    });
  }

  it("never writes if releasing the target audio cannot be confirmed", async () => {
    const { save, session, queue, synchronized } = fixture(false, false);
    await session.playTracks(queue, "row:1");
    let written = false;
    const saved = await save.run({
      targets: targets(1),
      writeTrackIds: [1],
      execute: async () => {
        written = true;
        return [result(1)];
      },
    });
    expect(written).toBe(false);
    expect(saved[0]?.databaseUpdated).toBe(false);
    expect(saved[0]?.error).toContain("未能确认");
    expect(session.state.currentPlaybackId.value).toBe(1);
    expect(save.state.saving).toBe(false);
    expect(synchronized).toEqual([]);
  });

  it("keeps playback when writing a different track or a database-only mark", async () => {
    const { save, session, queue, calls, synchronized } = fixture();
    await session.playTracks(queue, "row:1");
    await save.run({
      targets: targets(2),
      writeTrackIds: [2],
      execute: async () => [result(2)],
    });
    await save.run({
      targets: targets(1),
      writeTrackIds: [],
      execute: async () => {
        expect(session.state.isPlaybackCommandPending.value).toBe(false);
        return [{ ...result(1), fileWritten: false }];
      },
    });
    expect(calls.filter((command) => command === "beginEditing")).toHaveLength(1);
    expect(session.state.currentPlaybackId.value).toBe(1);
    expect(synchronized).toEqual([[2], [1]]);
  });

  it("retains partial success after a rejected request and treats every missing result as failed", async () => {
    const { save, session, queue, synchronized } = fixture();
    await session.playTracks(queue, "row:1");
    const saved = await save.run({
      targets: targets(1, 2),
      writeTrackIds: [1, 2],
      execute: async (progress) => {
        progress(result(1));
        throw new Error("interrupted");
      },
    });
    expect(saved[0]).toEqual(result(1));
    expect(saved[1]).toEqual({
      ...result(2, false),
      error: "interrupted",
    });
    expect(save.state.error).toBe("interrupted");
    expect(save.state.completed).toBe(2);
    expect(session.state.isPlaybackCommandPending.value).toBe(false);
    expect(synchronized).toEqual([[1]]);
    await save.run({
      targets: targets(2),
      writeTrackIds: [2],
      execute: async () => [result(2)],
    });
    expect(save.state.results).toEqual([result(1), result(2)]);
    expect(save.state.error).toBe("");
    expect(synchronized).toEqual([[1], [2]]);
  });

  it("keeps final save results even if playback cleanup rejects afterwards", async () => {
    const refreshed: MetadataTarget[][] = [];
    const save = createMetadataSave({
      editFiles: async (_ids, execute) => {
        await execute();
        throw new Error("playback refresh failed");
      },
      synchronize: (ids) => {
        refreshed.push(ids);
      },
    });
    const saved = await save.run({
      targets: targets(1),
      writeTrackIds: [1],
      execute: async () => [result(1)],
    });
    expect(saved).toEqual([result(1)]);
    expect(save.state.error).toBe("playback refresh failed");
    expect(refreshed).toEqual([[1]]);
  });

  it("filters foreign results, counts duplicate progress once and ignores progress after completion or reset", async () => {
    const { save, synchronized } = fixture();
    let lateProgress: (entry: MetadataSaveResult) => void = () => {};
    await save.run({
      targets: targets(1, 1, 2),
      writeTrackIds: [],
      execute: async (progress) => {
        lateProgress = progress;
        progress(result(99));
        progress(result(1, false));
        progress(result(1, false));
        expect(save.state.completed).toBe(1);
        expect(save.state.results).toEqual([result(1, false)]);
        return [result(1), result(99)];
      },
    });
    expect(save.state.results[0]).toEqual(result(1));
    expect(save.state.results[1]?.databaseUpdated).toBe(false);
    expect(save.state.results[1]?.error).toContain("未返回结果");
    expect(save.state.total).toBe(2);
    expect(synchronized).toEqual([[1]]);
    lateProgress(result(2));
    expect(save.state.results[1]?.databaseUpdated).toBe(false);
    save.reset();
    lateProgress(result(1));
    expect(save.state.results).toEqual([]);
    expect(save.state.completed).toBe(0);
  });

  it("retries synchronization without writing again or stopping playback", async () => {
    const { session, queue, calls } = fixture();
    let writes = 0;
    let refreshes = 0;
    const save = createMetadataSave({
      editFiles: session.withMetadataEditing,
      synchronize: async (ids) => {
        expect(ids).toEqual([2]);
        refreshes++;
        if (refreshes === 1) throw new Error("reload failed");
      },
    });
    await session.playTracks(queue, "row:1");
    await save.run({
      targets: targets(2),
      writeTrackIds: [2],
      execute: async () => {
        writes++;
        return [result(2)];
      },
    });
    expect(save.state.results).toEqual([result(2)]);
    expect(save.state.synchronizationError).toContain("reload failed");
    expect(save.state.error).toBe("");
    const commandCount = calls.length;
    await save.retrySynchronization();
    expect(save.state.synchronizationError).toBe("");
    expect(writes).toBe(1);
    expect(refreshes).toBe(2);
    expect(calls).toHaveLength(commandCount);
    await save.retrySynchronization();
    expect(refreshes).toBe(2);
  });

  it("defers batch refresh until requested, including file-only partial successes", async () => {
    const { session } = fixture();
    const refreshed: MetadataTarget[][] = [];
    const save = createMetadataSave({
      editFiles: session.withMetadataEditing,
      synchronize: (ids) => {
        refreshed.push(ids);
      },
      refreshWrittenFiles: true,
    });
    await save.run({
      targets: targets(1),
      writeTrackIds: [],
      deferSynchronization: true,
      execute: async () => [{ ...result(1, false), fileWritten: true }],
    });
    await save.run({
      targets: targets(2),
      writeTrackIds: [],
      deferSynchronization: true,
      execute: async () => [{ ...result(2), fileWritten: false }],
    });
    expect(refreshed).toEqual([]);
    expect(save.state.results[0]?.databaseUpdated).toBe(false);
    await save.retrySynchronization();
    expect(refreshed).toEqual([[1, 2]]);
  });

  it("rejects overlapping saves and ignores old progress during the next save", async () => {
    const { save } = fixture();
    let resolve!: (results: MetadataSaveResult[]) => void;
    let lateProgress: (entry: MetadataSaveResult) => void = () => {};
    const first = save.run({
      targets: targets(1),
      writeTrackIds: [],
      execute: (progress) => {
        lateProgress = progress;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const overlap = await save
      .run({ targets: targets(2), writeTrackIds: [], execute: async () => [result(2)] })
      .catch((error: unknown) => String(error));
    expect(overlap).toBe("Error: 元数据保存尚未完成，请稍后重试。");
    resolve([result(1)]);
    await first;
    await save.run({
      targets: targets(1),
      writeTrackIds: [],
      execute: async () => {
        lateProgress(result(1));
        expect(save.state.completed).toBe(0);
        return [];
      },
    });
    expect(save.state.results[0]?.databaseUpdated).toBe(false);
  });
});

it("preserves partial file/database outcomes when both the request and UI refresh fail", async () => {
  const { session, queue } = fixture();
  await session.playTracks(queue, "row:1");
  const fileOnly = {
    ...result(2, false),
    fileWritten: true,
    error: "文件已写入，数据库同步失败",
  };
  const save = createMetadataSave({
    editFiles: session.withMetadataEditing,
    synchronize: async () => {
      throw new Error("UI unavailable");
    },
  });
  const saved = await save.run({
    targets: targets(1, 2, 3),
    writeTrackIds: [1, 2, 3],
    execute: async (progress) => {
      progress(result(1));
      progress(fileOnly);
      throw new Error("connection lost");
    },
  });
  expect(saved).toEqual([result(1), fileOnly, { ...result(3, false), error: "connection lost" }]);
  expect(save.state.results).toEqual(saved);
  expect(save.state.completed).toBe(3);
  expect(save.state.saving).toBe(false);
  expect(save.state.error).toBe("connection lost");
  expect(save.state.synchronizationError).toContain("UI unavailable");
  expect(session.state.currentPlaybackId.value).toBeNull();
  await save.retrySynchronization();
  expect(save.state.results).toEqual(saved);
  expect(save.state.synchronizationError).toContain("UI unavailable");
});

it("preserves actual save outcomes and original request failure if backend endEditing also fails", async () => {
  const fixture = playbackFixture();
  await fixture.session.ready;
  const queue = [1, 2].map((trackId) => ({
    trackId,
    rowKey: `row:${trackId}`,
    title: "Track",
    album: null,
    durationMs: 100,
  }));
  await fixture.session.playTracks(queue, "row:1");
  fixture.fail("endEditing", new Error("cleanup unavailable"));
  const synchronized: MetadataTarget[][] = [];
  const save = createMetadataSave({
    editFiles: fixture.session.withMetadataEditing,
    synchronize: (ids) => {
      synchronized.push(ids);
    },
  });
  const saved = await save.run({
    targets: targets(1, 2),
    writeTrackIds: [1, 2],
    execute: async (progress) => {
      progress(result(1));
      throw new Error("write interrupted");
    },
  });
  expect(saved).toEqual([result(1), { ...result(2, false), error: "write interrupted" }]);
  expect(save.state.results).toEqual(saved);
  expect(save.state.error).toBe("write interrupted");
  expect(save.state.saving).toBe(false);
  expect(synchronized).toEqual([[1]]);
  expect(fixture.session.state.currentPlaybackId.value).toBeNull();
  expect(fixture.session.state.playbackError.value).toBe("播放操作失败，请重试或查看日志");
});

it("returns completed results even when ending the backend editing lease fails", async () => {
  const fixture = playbackFixture();
  await fixture.session.ready;
  fixture.fail("endEditing", new Error("cleanup unavailable"));
  const saved = await fixture.session.withMetadataEditing([1], async () => [result(1)]);
  expect(saved).toEqual([result(1)]);
  expect(fixture.session.state.playbackError.value).toBe("播放操作失败，请重试或查看日志");
});
