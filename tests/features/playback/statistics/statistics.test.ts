import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import type { TrackPlayStatistics } from "@/features/playback/statistics/usePlaybackStatistics";
import type { NotificationInput } from "@/shared/notifications/center";
import { setLocale } from "@/shared/i18n/locale";
import { evaluateModule, transpileScript } from "../../../support/module/loader";

const output = transpileScript(
  await Bun.file(
    new URL(
      "../../../../src/features/playback/statistics/usePlaybackStatistics.ts",
      import.meta.url,
    ),
  ).text(),
);
type Statistics = ReturnType<
  typeof import("@/features/playback/statistics/usePlaybackStatistics").usePlaybackStatistics
>;
const track: TrackPlayStatistics = {
  trackId: 1,
  title: "Song",
  artist: "Artist",
  album: "Album",
  playCount: 1,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness(options: { desktop?: boolean; registration?: Promise<void> } = {}) {
  const events = new Map<string, () => void>();
  const stopped: string[] = [];
  const requests: Array<ReturnType<typeof deferred<TrackPlayStatistics[]>>> = [];
  const notices: NotificationInput[] = [];
  let dispose = () => {};
  const { usePlaybackStatistics } = evaluateModule<{ usePlaybackStatistics: () => Statistics }>(
    output,
    {
      vue: {
        ...Vue,
        onUnmounted: (callback: () => void) => {
          dispose = callback;
        },
      },
      "@tauri-apps/api/core": {
        isTauri: () => options.desktop ?? true,
        invoke: (command: string) => {
          expect(command).toBe("list_playback_statistics");
          const request = deferred<TrackPlayStatistics[]>();
          requests.push(request);
          return request.promise;
        },
      },
      "@tauri-apps/api/event": {
        listen: async (event: string, callback: () => void) => {
          await options.registration;
          events.set(event, callback);
          return () => {
            stopped.push(event);
            events.delete(event);
          };
        },
      },
      "@/shared/notifications/center": {
        notify: (input: NotificationInput) => notices.push(input),
      },
    },
  );
  const statistics = usePlaybackStatistics();
  return { statistics, requests, events, stopped, notices, dispose: () => dispose() };
}

async function flush() {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

afterEach(() => setLocale("zh-CN"));

describe("playback statistics", () => {
  it("queries on open, updates counts and deletions while open, and stops querying when closed", async () => {
    const h = harness();
    const opened = h.statistics.open();
    await flush();
    expect(h.statistics.isLoading.value).toBe(true);
    h.requests[0]!.resolve([track]);
    await opened;
    expect(h.statistics.tracks.value).toEqual([track]);
    h.events.get("playback-statistics-changed")!();
    h.requests[1]!.resolve([{ ...track, playCount: 2 }]);
    await flush();
    expect(h.statistics.tracks.value[0]!.playCount).toBe(2);
    h.events.get("playback-statistics-changed")!();
    h.requests[2]!.resolve([]);
    await flush();
    expect(h.statistics.tracks.value).toEqual([]);
    h.statistics.close();
    h.events.get("playback-statistics-changed")!();
    expect(h.requests).toHaveLength(3);
    const reopened = h.statistics.open();
    await flush();
    h.requests[3]!.resolve([track]);
    await reopened;
    expect(h.statistics.tracks.value).toEqual([track]);
    h.dispose();
    expect(h.events.size).toBe(0);
    expect(h.stopped).toHaveLength(2);
  });

  it("ignores stale responses and completions after close", async () => {
    const h = harness();
    const opened = h.statistics.open();
    await flush();
    h.events.get("playback-statistics-changed")!();
    h.requests[1]!.resolve([{ ...track, playCount: 3 }]);
    await flush();
    h.requests[0]!.resolve([track]);
    await opened;
    expect(h.statistics.tracks.value[0]!.playCount).toBe(3);
    h.events.get("playback-statistics-changed")!();
    h.statistics.close();
    h.requests[2]!.resolve([]);
    await flush();
    expect(h.statistics.tracks.value[0]!.playCount).toBe(3);
    expect(h.statistics.isLoading.value).toBe(false);
    h.dispose();
  });

  it("retains saved statistics when refresh fails and notifies save failures without issuing a write", async () => {
    const h = harness();
    const opened = h.statistics.open();
    await flush();
    h.requests[0]!.resolve([track]);
    await opened;
    h.events.get("playback-statistics-changed")!();
    h.requests[1]!.reject(new Error("database unavailable"));
    await flush();
    expect(h.statistics.loadFailed.value).toBe(true);
    expect(h.statistics.tracks.value).toEqual([track]);
    h.statistics.close();
    h.events.get("playback-statistics-save-failed")!();
    expect(h.notices).toEqual([
      { type: "error", message: "读取播放统计失败", key: "playback-statistics" },
      { type: "error", message: "保存播放统计失败", key: "playback-statistics" },
    ]);
    expect(h.requests).toHaveLength(2);
    h.dispose();
  });

  it("unsubscribes when listener registration completes after unmount", async () => {
    const registration = deferred<void>();
    const h = harness({ registration: registration.promise });
    h.dispose();
    registration.resolve();
    await flush();
    expect(h.stopped).toHaveLength(2);
    expect(h.events.size).toBe(0);
  });

  it("does not invoke native APIs in browser preview", async () => {
    const h = harness({ desktop: false });
    await h.statistics.open();
    expect(h.requests).toHaveLength(0);
    expect(h.events.size).toBe(0);
    h.dispose();
  });
});
