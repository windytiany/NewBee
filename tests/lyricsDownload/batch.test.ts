import { describe, expect, it } from "bun:test";
import { createLyricsBatch } from "@/lyricsDownload/batch";
import type { LyricsBatchOptions } from "@/lyricsDownload/batch";
import type { LyricsContent } from "@/lyricsDownload/model";
import type { NotificationInput, TaskNotification } from "@/notification/center";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(overrides: Partial<LyricsBatchOptions> = {}) {
  const writes: Array<[number, string]> = [];
  const messages: NotificationInput[] = [];
  const tasks = new Map<string, TaskNotification>();
  const finished: number[] = [];
  const cancelled: number[] = [];
  const begun: number[][] = [];
  let synchronized = 0;
  const batch = createLyricsBatch({
    begin: async (ids) => {
      begun.push(ids);
      return 1;
    },
    fetch: async (_batch, id) => ({ kind: "available", text: `lyrics ${id}` }),
    write: async (_batch, id, text) => {
      writes.push([id, text]);
      return {
        trackId: id,
        path: `${id}.mp3`,
        fileWritten: true,
        databaseUpdated: true,
        error: null,
      };
    },
    cancel: async (id) => {
      cancelled.push(id);
    },
    finish: async (id) => {
      finished.push(id);
    },
    loadAlbum: async () => [1, 2, 1],
    synchronize: () => {
      synchronized++;
    },
    notifications: {
      notify: (input) => {
        messages.push(input);
        return 1;
      },
      updateTask: (task) => {
        tasks.set(task.key, task);
      },
      removeTask: (key) => {
        tasks.delete(key);
      },
    },
    ...overrides,
  });
  return {
    batch,
    writes,
    messages,
    tasks,
    finished,
    cancelled,
    begun,
    synchronized: () => synchronized,
  };
}

describe("lyrics batch", () => {
  it("writes distinct lyrics immediately for every selected track without any existing-lyrics reads", async () => {
    const result = setup();
    await result.batch.startTracks([1, 2, 1]);
    expect(result.begun).toEqual([[1, 2]]);
    expect(result.writes).toEqual([
      [1, "lyrics 1"],
      [2, "lyrics 2"],
    ]);
    expect(result.finished).toEqual([1]);
    expect(result.synchronized()).toBe(1);
    expect(result.tasks.size).toBe(0);
    expect(result.messages[0]?.message).toContain("2 首已写入");
    expect(result.batch.state.running).toBe(false);
  });
  it("leaves files untouched on missing, instrumental and network failure, then continues", async () => {
    const result = setup({
      fetch: async (_batch, id) => {
        if (id === 1) return { kind: "missing" };
        if (id === 2) return { kind: "instrumental" };
        if (id === 3) throw new Error("timeout");
        return { kind: "available", text: "correct" };
      },
    });
    await result.batch.startTracks([1, 2, 3, 4]);
    expect(result.writes).toEqual([[4, "correct"]]);
    expect(result.messages[0]?.message).toContain("1 首未找到，1 首纯音乐，1 首失败");
  });
  it("cancels during a request without writing its late result or processing later tracks", async () => {
    const request = deferred<LyricsContent>();
    const result = setup({ fetch: () => request.promise });
    const running = result.batch.startTracks([1, 2]);
    await Promise.resolve();
    await Promise.resolve();
    expect(result.tasks.size).toBe(1);
    result.batch.cancel();
    request.resolve({ kind: "available", text: "late" });
    await running;
    expect(result.writes).toEqual([]);
    expect(result.cancelled).toEqual([1]);
    expect(result.finished).toEqual([1]);
    expect(result.tasks.size).toBe(0);
    expect(result.messages[0]?.message).toContain("已取消");
  });
  it("finishes an in-flight write after cancellation but never starts the next track", async () => {
    const write = deferred<Awaited<ReturnType<LyricsBatchOptions["write"]>>>();
    let started = 0;
    const result = setup({
      write: () => {
        started++;
        return write.promise;
      },
    });
    const running = result.batch.startTracks([1, 2]);
    for (let index = 0; index < 5; index++) await Promise.resolve();
    expect(started).toBe(1);
    result.batch.cancel();
    write.resolve({
      trackId: 1,
      path: "1.mp3",
      fileWritten: true,
      databaseUpdated: true,
      error: null,
    });
    await running;
    expect(started).toBe(1);
    expect(result.batch.state.written).toBe(1);
    expect(result.synchronized()).toBe(1);
  });
  it("rejects duplicate task starts and resolves album targets", async () => {
    const request = deferred<LyricsContent>();
    const result = setup({ fetch: () => request.promise });
    const running = result.batch.startAlbum({ album: "Album", albumArtist: "Artist" });
    await result.batch.startTracks([9]);
    request.resolve({ kind: "missing" });
    await running;
    expect(result.begun).toEqual([[1, 2]]);
  });
  it("cleans up progress on start failure", async () => {
    const result = setup({
      begin: async () => {
        throw new Error("scan already running");
      },
    });
    await result.batch.startTracks([1]);
    expect(result.messages[0]?.message).toBe("scan already running");
    expect(result.finished).toEqual([]);
    expect(result.tasks.size).toBe(0);
    expect(result.batch.state.running).toBe(false);
  });
});
