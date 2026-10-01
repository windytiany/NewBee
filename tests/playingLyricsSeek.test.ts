// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { describe, expect, it } from "bun:test";
import { ref } from "vue";
import type { PlaybackStatus } from "@/playback/status";
import type { PlayingLyricsState } from "@/playing/useLyrics";
import { canSeekLyrics, seekToLyric } from "@/playing/seek";
import type { LyricsSeekSession } from "@/playing/seek";

type SessionOptions = {
  trackId?: number | null;
  playbackStatus?: Partial<PlaybackStatus>;
  commandPending?: boolean;
  isSeeking?: boolean;
  seekResult?: boolean;
  seekError?: string;
};

function createSession(options: SessionOptions = {}) {
  const calls: Array<{ command: "beginSeeking" | "seekTo"; positionMs?: number }> = [];
  const playbackError = ref("");
  const state = {
    currentTrack: ref<{ trackId: number } | null>(
      options.trackId === null ? null : { trackId: options.trackId ?? 7 },
    ),
    playbackStatus: ref<PlaybackStatus>({
      hasAudio: true,
      isPlaying: false,
      hasEnded: false,
      positionMs: 0,
      durationMs: 1_000,
      ...options.playbackStatus,
    }),
    isPlaybackCommandPending: ref(options.commandPending ?? false),
    isSeeking: ref(options.isSeeking ?? false),
  };
  const session: LyricsSeekSession = {
    state,
    beginSeeking() {
      calls.push({ command: "beginSeeking" });
      state.isSeeking.value = true;
    },
    async seekTo(positionMs) {
      calls.push({ command: "seekTo", positionMs });
      if (options.seekResult === false) playbackError.value = options.seekError ?? "Seek failed";
      state.isSeeking.value = false;
      return options.seekResult ?? true;
    },
  };
  return { session, calls, playbackError };
}

const syncedLyrics: PlayingLyricsState = {
  status: "ready",
  lyrics: {
    kind: "synced",
    lines: [
      { startMs: 100, text: "First line" },
      { startMs: 250, text: "Second line" },
      { startMs: 1_000, text: "Last line" },
    ],
  },
};

describe("歌词跳转", () => {
  it("先开始 seek，再通过共享 session 跳转到当前同步歌词的时间点", async () => {
    const { session, calls } = createSession();

    expect(canSeekLyrics(session, syncedLyrics)).toBe(true);
    expect(await seekToLyric(session, syncedLyrics, 7, 250)).toBe(true);
    expect(calls).toEqual([{ command: "beginSeeking" }, { command: "seekTo", positionMs: 250 }]);
  });

  it("播放中和暂停时都允许跳转", async () => {
    for (const isPlaying of [true, false]) {
      const { session, calls } = createSession({ playbackStatus: { isPlaying } });

      expect(await seekToLyric(session, syncedLyrics, 7, 100)).toBe(true);
      expect(calls.map((call) => call.command)).toEqual(["beginSeeking", "seekTo"]);
    }
  });

  it("无音频、播放命令执行中或已有 seek 时不可跳转", async () => {
    const unavailableSessions = [
      createSession({ playbackStatus: { hasAudio: false } }),
      createSession({ commandPending: true }),
      createSession({ isSeeking: true }),
    ];

    for (const { session, calls } of unavailableSessions) {
      expect(canSeekLyrics(session, syncedLyrics)).toBe(false);
      expect(await seekToLyric(session, syncedLyrics, 7, 100)).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  it("拒绝来自旧曲目的点击事件", async () => {
    const { session, calls } = createSession({ trackId: 8 });

    expect(await seekToLyric(session, syncedLyrics, 7, 250)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("只允许 ready 的同步歌词作为跳转来源", async () => {
    const unavailableLyrics: PlayingLyricsState[] = [
      { status: "idle" },
      { status: "loading" },
      { status: "error", message: "unavailable" },
      { status: "ready", lyrics: { kind: "plain", text: "Plain text" } },
      { status: "ready", lyrics: { kind: "none" } },
    ];

    for (const lyrics of unavailableLyrics) {
      const { session, calls } = createSession();

      expect(canSeekLyrics(session, lyrics)).toBe(false);
      expect(await seekToLyric(session, lyrics, 7, 100)).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  it("拒绝不存在、负数及非有限的目标时间", async () => {
    for (const startMs of [200, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { session, calls } = createSession();

      expect(await seekToLyric(session, syncedLyrics, 7, startMs)).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  it("目标超出已知时长时拒绝跳转，不做截断", async () => {
    const { session, calls } = createSession({
      playbackStatus: { durationMs: 999 },
    });

    expect(await seekToLyric(session, syncedLyrics, 7, 1_000)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("session 跳转失败时返回失败并保留 session 的错误反馈", async () => {
    const { session, calls, playbackError } = createSession({
      seekResult: false,
      seekError: "Seek failed: backend unavailable",
    });

    expect(await seekToLyric(session, syncedLyrics, 7, 250)).toBe(false);
    expect(calls).toEqual([{ command: "beginSeeking" }, { command: "seekTo", positionMs: 250 }]);
    expect(playbackError.value).toBe("Seek failed: backend unavailable");
  });
});
