import { expect, it } from "bun:test";
import { computed, effectScope, ref, type Ref } from "vue";
import * as Vue from "vue";
import { evaluateSource, transpileScript } from "../../support/module/loader";
import { useSidecar } from "@/features/lyrics/useSidecar";
import type { TrackLyrics } from "@/features/lyrics/types";
import type { PlaybackCommandInvoker } from "@/features/playback/types";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it("loads an already playing track, ignores stale reads, and retains lyrics while editing", async () => {
  const snapshot = ref<{ trackId: number | null; playbackId: number | null }>({
    trackId: 1,
    playbackId: 1,
  });
  const currentTrack = computed(() =>
    snapshot.value.trackId === null ? null : { trackId: snapshot.value.trackId },
  );
  const currentPlaybackId = computed(() => snapshot.value.playbackId);
  const reads: number[] = [];
  let finishFirst!: (lyrics: TrackLyrics) => void;
  const first = new Promise<TrackLyrics>((resolve) => {
    finishFirst = resolve;
  });
  const second = { kind: "plain", text: "Second" } as const;
  const invokeCommand: PlaybackCommandInvoker = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => {
    expect(command).toBe("get_playback_sidecar_lyrics");
    reads.push(args?.trackId as number);
    return (reads.length === 1 ? await first : second) as T;
  };
  const scope = effectScope();
  const lyrics = scope.run(() => useSidecar({ currentTrack, currentPlaybackId, invokeCommand }))!;
  try {
    snapshot.value = { trackId: 2, playbackId: 2 };
    finishFirst({ kind: "plain", text: "Stale" });
    await settle();
    expect(lyrics.value).toEqual(second);
    snapshot.value = { trackId: 2, playbackId: null };
    expect(lyrics.value).toEqual(second);
    expect(reads).toEqual([1, 2]);
    snapshot.value = { trackId: 2, playbackId: 3 };
    await settle();
    expect(reads).toEqual([1, 2, 2]);
    snapshot.value = { trackId: null, playbackId: null };
    expect(lyrics.value).toBeNull();
  } finally {
    scope.stop();
  }
});

it("stops watching and ignores pending sidecar replies after disposal", async () => {
  const currentTrack = ref({ trackId: 1 });
  const currentPlaybackId = ref<number | null>(1);
  let finish!: (lyrics: TrackLyrics) => void;
  let reads = 0;
  const pending = new Promise<TrackLyrics>((resolve) => {
    finish = resolve;
  });
  const invokeCommand: PlaybackCommandInvoker = async <T>() => {
    reads++;
    return (await pending) as T;
  };
  const scope = effectScope();
  const lyrics = scope.run(() => useSidecar({ currentTrack, currentPlaybackId, invokeCommand }))!;
  scope.stop();
  finish({ kind: "plain", text: "Late" });
  currentPlaybackId.value = 2;
  await settle();
  expect(lyrics.value).toBeNull();
  expect(reads).toBe(1);
});

it("keeps playback lyrics across page unmounts and follows tracks while no page is mounted", async () => {
  const currentTrack = ref({ trackId: 1 });
  const currentPlaybackId = ref<number | null>(1);
  const reads: number[] = [];
  const module = evaluateSource<{ usePlaybackLyrics: () => Readonly<Ref<TrackLyrics | null>> }>(
    transpileScript(await Bun.file("src/features/lyrics/useSidecar.ts").text()),
    {
      vue: Vue,
      "@/features/playback/session": {
        usePlaybackSession: () => ({ state: { currentTrack, currentPlaybackId } }),
      },
      "@tauri-apps/api/core": {
        invoke: async (_command: string, args: { trackId: number }) => {
          reads.push(args.trackId);
          return { kind: "plain", text: String(args.trackId) };
        },
      },
    },
  );
  const page = effectScope();
  const lyrics = page.run(() => module.usePlaybackLyrics())!;
  await settle();
  page.stop();
  currentTrack.value = { trackId: 2 };
  await settle();
  expect(lyrics.value).toEqual({ kind: "plain", text: "2" });
  expect(module.usePlaybackLyrics()).toBe(lyrics);
  expect(reads).toEqual([1, 2]);
});
