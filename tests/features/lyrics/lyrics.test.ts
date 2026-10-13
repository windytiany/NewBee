import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { notifications, notify } from "@/shared/notifications/center";
import { TRACKS_CHANGED_EVENT } from "@/features/tracks/events";
import { transpileScript, evaluateSource } from "../../support/module/loader";

import { effectScope, nextTick, ref } from "vue";
import type { EffectScope, Ref } from "vue";
import type { PlaybackCommandInvoker, PlaybackStatus } from "@/features/playback/types";

import type { LyricLine, TrackLyrics } from "@/features/lyrics/types";
import type { useLyrics as usePlayingLyricsComposable } from "@/features/lyrics/composables/useLyrics";

type TestTrack = Readonly<{ trackId: number; title: string }>;
type InvokeCall = { command: string; args?: Record<string, unknown> };
type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: unknown) => void;
};

const scopes: EffectScope[] = [];
const EMPTY_PLAYBACK_STATUS: PlaybackStatus = {
  hasAudio: false,
  isPlaying: false,
  hasEnded: false,
  positionMs: 0,
  durationMs: 0,
};

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createInvoker(
  requestLyrics: (trackId: number) => Promise<TrackLyrics>,
  calls: InvokeCall[] = [],
): PlaybackCommandInvoker {
  return async <Result>(command: string, args?: Record<string, unknown>): Promise<Result> => {
    calls.push({ command, args });
    if (command !== "get_track_lyrics" || typeof args?.trackId !== "number") {
      throw new Error("Unexpected lyrics request.");
    }
    return (await requestLyrics(args.trackId)) as Result;
  };
}

function mountPlayingLyrics(
  currentTrack: Ref<TestTrack | null> = ref<TestTrack | null>(null),
  playbackStatus: Ref<PlaybackStatus> = ref({ ...EMPTY_PLAYBACK_STATUS }),
  invokeCommand: PlaybackCommandInvoker = createInvoker(async () => ({ kind: "none" })),
) {
  let lyrics!: ReturnType<typeof usePlayingLyricsComposable>;
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => {
    lyrics = useLyrics({ currentTrack, playbackStatus, invokeCommand });
  });
  return { lyrics, scope };
}

async function settleLyricsRequests() {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

const syncedLyrics: TrackLyrics = {
  kind: "synced",
  lines: [
    { startMs: 100, text: "First" },
    { startMs: 200, text: "Group one" },
    { startMs: 200, text: "Group two" },
    { startMs: 400, text: "Last" },
  ],
};

const { getActiveLyricIndices, useLyrics } = evaluateSource<
  typeof import("@/features/lyrics/composables/useLyrics")
>(
  transpileScript(
    await Bun.file(
      new URL("../../../src/features/lyrics/composables/useLyrics.ts", import.meta.url),
    ).text(),
  ),
  {
    vue: Vue,
    "@/shared/notifications/center": { notify },
    "@/features/tracks/events": { TRACKS_CHANGED_EVENT },
    "@tauri-apps/api/core": {
      invoke: async () => {
        throw new Error("The default invoke should not be used in these tests.");
      },
    },
  },
);

afterEach(() => {
  notifications.clear();
  for (const scope of scopes.splice(0)) scope.stop();
});

describe("NowPlayingPage 歌词状态", () => {
  it("保存元数据后重新读取当前歌词，并在销毁时移除订阅", async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const window = new EventTarget();
    Object.defineProperty(globalThis, "window", { configurable: true, value: window });
    try {
      const calls: InvokeCall[] = [];
      let text = "Original";
      const { lyrics, scope } = mountPlayingLyrics(
        ref<TestTrack | null>({ trackId: 11, title: "Song" }),
        ref({ ...EMPTY_PLAYBACK_STATUS }),
        createInvoker(async () => ({ kind: "plain", text }), calls),
      );
      await settleLyricsRequests();
      text = "Edited";
      window.dispatchEvent(new Event(TRACKS_CHANGED_EVENT));
      await settleLyricsRequests();
      expect(lyrics.state.value).toEqual({
        status: "ready",
        lyrics: { kind: "plain", text: "Edited" },
      });
      expect(calls).toHaveLength(2);
      scope.stop();
      window.dispatchEvent(new Event(TRACKS_CHANGED_EVENT));
      expect(calls).toHaveLength(2);
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("无当前曲目时保持 idle 且不读取歌词", () => {
    const calls: InvokeCall[] = [];
    const { lyrics } = mountPlayingLyrics(
      ref<TestTrack | null>(null),
      ref({ ...EMPTY_PLAYBACK_STATUS }),
      createInvoker(async () => ({ kind: "none" }), calls),
    );

    expect(lyrics.state.value).toEqual({ status: "idle" });
    expect(lyrics.activeIndex.value).toBe(-1);
    expect(lyrics.activeGroupStartIndex.value).toBe(-1);
    expect(calls).toEqual([]);
  });

  it("成功读取同步歌词并传入 trackId", async () => {
    const calls: InvokeCall[] = [];
    const { lyrics } = mountPlayingLyrics(
      ref<TestTrack | null>({ trackId: 11, title: "Song" }),
      ref({ ...EMPTY_PLAYBACK_STATUS, positionMs: 200 }),
      createInvoker(async () => syncedLyrics, calls),
    );

    expect(lyrics.state.value).toEqual({ status: "loading" });
    await settleLyricsRequests();

    expect(calls).toEqual([{ command: "get_track_lyrics", args: { trackId: 11 } }]);
    expect(lyrics.state.value).toEqual({ status: "ready", lyrics: syncedLyrics });
    expect(lyrics.activeIndex.value).toBe(2);
    expect(lyrics.activeGroupStartIndex.value).toBe(1);
    expect(lyrics.activeLine.value).toEqual(syncedLyrics.lines[2]);
    expect(lyrics.activeGroupStartLine.value).toEqual(syncedLyrics.lines[1]);
  });

  it("把 none 和 plain 都视为成功且不计算时间轴", async () => {
    const currentTrack = ref<TestTrack | null>({ trackId: 12, title: "No lyrics" });
    const playbackStatus = ref({ ...EMPTY_PLAYBACK_STATUS, positionMs: 10_000 });
    const { lyrics } = mountPlayingLyrics(
      currentTrack,
      playbackStatus,
      createInvoker(async (trackId) =>
        trackId === 12 ? { kind: "none" } : { kind: "plain", text: "Un-timed lyrics" },
      ),
    );

    await settleLyricsRequests();
    expect(lyrics.state.value).toEqual({ status: "ready", lyrics: { kind: "none" } });
    expect(lyrics.activeIndex.value).toBe(-1);
    expect(lyrics.activeGroupStartIndex.value).toBe(-1);
    expect(lyrics.activeLine.value).toBeNull();
    expect(lyrics.activeGroupStartLine.value).toBeNull();

    currentTrack.value = { trackId: 13, title: "Plain lyrics" };
    await settleLyricsRequests();
    expect(lyrics.state.value).toEqual({
      status: "ready",
      lyrics: { kind: "plain", text: "Un-timed lyrics" },
    });
    expect(lyrics.activeIndex.value).toBe(-1);
    expect(lyrics.activeGroupStartIndex.value).toBe(-1);
    expect(lyrics.activeLine.value).toBeNull();
    expect(lyrics.activeGroupStartLine.value).toBeNull();
  });

  it("把读取失败作为独立 error 状态暴露", async () => {
    const { lyrics } = mountPlayingLyrics(
      ref<TestTrack | null>({ trackId: 14, title: "Unavailable" }),
      ref({ ...EMPTY_PLAYBACK_STATUS }),
      createInvoker(async () => {
        throw new Error("database unavailable");
      }),
    );

    await settleLyricsRequests();

    expect(lyrics.state.value).toEqual({ status: "error", message: "database unavailable" });
    expect(lyrics.activeIndex.value).toBe(-1);
    expect(lyrics.activeGroupStartIndex.value).toBe(-1);
  });

  it("并发消费者对同一次读取失败只通知一次，后续请求仍可通知", async () => {
    const request = deferred<TrackLyrics>();
    let calls = 0;
    const invoker = createInvoker(() => {
      calls++;
      return request.promise;
    });
    const track = ref<TestTrack | null>({ trackId: 15, title: "Song" });
    const first = mountPlayingLyrics(track, ref({ ...EMPTY_PLAYBACK_STATUS }), invoker);
    const second = mountPlayingLyrics(track, ref({ ...EMPTY_PLAYBACK_STATUS }), invoker);
    expect(calls).toBe(1);
    request.reject(new Error("read failed"));
    await settleLyricsRequests();
    expect(first.lyrics.state.value.status).toBe("error");
    expect(second.lyrics.state.value.status).toBe("error");
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.count).toBe(1);
    expect(notifications.items.value[0]?.key).toBe("lyrics-read:15");
    notifications.clear();
    track.value = null;
    track.value = { trackId: 15, title: "Song again" };
    await settleLyricsRequests();
    expect(calls).toBe(2);
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.count).toBe(1);
  });

  it("切歌立即清除旧歌词与错误，并在没有曲目时回到 idle", async () => {
    const requestB = deferred<TrackLyrics>();
    const requestC = deferred<TrackLyrics>();
    const currentTrack = ref<TestTrack | null>({ trackId: 21, title: "Ready" });
    const { lyrics } = mountPlayingLyrics(
      currentTrack,
      ref({ ...EMPTY_PLAYBACK_STATUS }),
      createInvoker(async (trackId) => {
        if (trackId === 21) return syncedLyrics;
        if (trackId === 22) return requestB.promise;
        return requestC.promise;
      }),
    );

    await settleLyricsRequests();
    expect(lyrics.state.value.status).toBe("ready");

    currentTrack.value = { trackId: 22, title: "Pending" };
    expect(lyrics.state.value).toEqual({ status: "loading" });
    expect(lyrics.activeLine.value).toBeNull();
    requestB.reject(new Error("second track failed"));
    await settleLyricsRequests();
    expect(lyrics.state.value).toEqual({ status: "error", message: "second track failed" });

    currentTrack.value = { trackId: 23, title: "Pending after error" };
    expect(lyrics.state.value).toEqual({ status: "loading" });
    requestC.resolve(syncedLyrics);
    await settleLyricsRequests();
    expect(lyrics.state.value.status).toBe("ready");

    currentTrack.value = null;
    expect(lyrics.state.value).toEqual({ status: "idle" });
    expect(lyrics.activeLine.value).toBeNull();
  });

  it("忽略 A 切到 B 之后返回的旧成功", async () => {
    const requestA = deferred<TrackLyrics>();
    const requestB = deferred<TrackLyrics>();
    const currentTrack = ref<TestTrack | null>({ trackId: 31, title: "A" });
    const { lyrics } = mountPlayingLyrics(
      currentTrack,
      ref({ ...EMPTY_PLAYBACK_STATUS }),
      createInvoker((trackId) => (trackId === 31 ? requestA.promise : requestB.promise)),
    );

    currentTrack.value = { trackId: 32, title: "B" };
    expect(lyrics.state.value).toEqual({ status: "loading" });
    requestB.resolve({ kind: "plain", text: "LyricsView for B" });
    await settleLyricsRequests();
    expect(lyrics.state.value).toEqual({
      status: "ready",
      lyrics: { kind: "plain", text: "LyricsView for B" },
    });

    requestA.resolve({ kind: "plain", text: "Stale lyrics for A" });
    await settleLyricsRequests();
    expect(lyrics.state.value).toEqual({
      status: "ready",
      lyrics: { kind: "plain", text: "LyricsView for B" },
    });
  });

  it("忽略 A 切到 B 之后返回的旧失败", async () => {
    const requestA = deferred<TrackLyrics>();
    const requestB = deferred<TrackLyrics>();
    const currentTrack = ref<TestTrack | null>({ trackId: 41, title: "A" });
    const { lyrics } = mountPlayingLyrics(
      currentTrack,
      ref({ ...EMPTY_PLAYBACK_STATUS }),
      createInvoker((trackId) => (trackId === 41 ? requestA.promise : requestB.promise)),
    );

    currentTrack.value = { trackId: 42, title: "B" };
    requestB.resolve({ kind: "none" });
    await settleLyricsRequests();
    expect(lyrics.state.value).toEqual({ status: "ready", lyrics: { kind: "none" } });

    requestA.reject(new Error("stale failure for A"));
    await settleLyricsRequests();
    expect(lyrics.state.value).toEqual({ status: "ready", lyrics: { kind: "none" } });
    expect(notifications.items.value).toHaveLength(0);
  });

  it("scope 销毁后忽略尚未完成的请求", async () => {
    const request = deferred<TrackLyrics>();
    const { lyrics, scope } = mountPlayingLyrics(
      ref<TestTrack | null>({ trackId: 51, title: "Disposed" }),
      ref({ ...EMPTY_PLAYBACK_STATUS }),
      createInvoker(async () => request.promise),
    );

    expect(lyrics.state.value).toEqual({ status: "loading" });
    scope.stop();
    request.resolve(syncedLyrics);
    await settleLyricsRequests();

    expect(lyrics.state.value).toEqual({ status: "loading" });
  });

  it("相同 trackId 的曲目与播放状态更新不会重复读取歌词", async () => {
    const request = deferred<TrackLyrics>();
    const calls: InvokeCall[] = [];
    const currentTrack = ref<TestTrack | null>({ trackId: 61, title: "Original title" });
    const playbackStatus = ref({ ...EMPTY_PLAYBACK_STATUS, positionMs: 0 });
    const { lyrics } = mountPlayingLyrics(
      currentTrack,
      playbackStatus,
      createInvoker(async () => request.promise, calls),
    );

    currentTrack.value = { trackId: 61, title: "Updated title" };
    playbackStatus.value = { ...playbackStatus.value, positionMs: 200, isPlaying: false };
    await nextTick();
    expect(calls).toEqual([{ command: "get_track_lyrics", args: { trackId: 61 } }]);

    request.resolve(syncedLyrics);
    await settleLyricsRequests();
    expect(lyrics.activeIndex.value).toBe(2);
    expect(calls).toHaveLength(1);
  });

  it("按播放位置前跳和回跳更新活动行，不自行累计暂停时间", async () => {
    const playbackStatus = ref({ ...EMPTY_PLAYBACK_STATUS, positionMs: 100, isPlaying: false });
    const { lyrics } = mountPlayingLyrics(
      ref<TestTrack | null>({ trackId: 71, title: "Jumping" }),
      playbackStatus,
      createInvoker(async () => syncedLyrics),
    );
    await settleLyricsRequests();

    expect(lyrics.activeIndex.value).toBe(0);
    playbackStatus.value = { ...playbackStatus.value, positionMs: 250 };
    expect(lyrics.activeIndex.value).toBe(2);
    expect(lyrics.activeGroupStartIndex.value).toBe(1);

    playbackStatus.value = { ...playbackStatus.value, positionMs: 50 };
    expect(lyrics.activeIndex.value).toBe(-1);
    playbackStatus.value = { ...playbackStatus.value, positionMs: 500 };
    expect(lyrics.activeIndex.value).toBe(3);
    expect(lyrics.activeLine.value).toEqual(syncedLyrics.lines[3]);
  });
});

describe("歌词时间轴", () => {
  const lines: LyricLine[] = [
    { startMs: 100, text: "First" },
    { startMs: 200, text: "Group one" },
    { startMs: 200, text: "Group two" },
    { startMs: 400, text: "Last" },
  ];

  it("处理空数组、首句之前、精确时间点、时间点之间及末句之后", () => {
    expect(getActiveLyricIndices([], 100)).toEqual({
      activeIndex: -1,
      activeGroupStartIndex: -1,
    });
    expect(getActiveLyricIndices(lines, 99)).toEqual({
      activeIndex: -1,
      activeGroupStartIndex: -1,
    });
    expect(getActiveLyricIndices(lines, 100)).toEqual({
      activeIndex: 0,
      activeGroupStartIndex: 0,
    });
    expect(getActiveLyricIndices(lines, 150)).toEqual({
      activeIndex: 0,
      activeGroupStartIndex: 0,
    });
    expect(getActiveLyricIndices(lines, 400)).toEqual({
      activeIndex: 3,
      activeGroupStartIndex: 3,
    });
    expect(getActiveLyricIndices(lines, 900)).toEqual({
      activeIndex: 3,
      activeGroupStartIndex: 3,
    });
  });

  it("把相同 startMs 的所有行归入活动组", () => {
    expect(getActiveLyricIndices(lines, 200)).toEqual({
      activeIndex: 2,
      activeGroupStartIndex: 1,
    });
  });
});
