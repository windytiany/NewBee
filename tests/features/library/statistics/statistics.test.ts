import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import type { TrackPlayStatistics } from "@/features/library/statistics/useStatistics";
import type { AlbumSummary } from "@/features/library/types";
import { evaluateModule, transpileScript } from "../../../support/module/loader";

const output = transpileScript(
  await Bun.file(
    new URL("../../../../src/features/library/statistics/useStatistics.ts", import.meta.url),
  ).text(),
);
type Statistics = ReturnType<
  typeof import("@/features/library/statistics/useStatistics").useStatistics
>;
const album: AlbumSummary = { albumArtist: "Artist", album: "Album", year: null };
const track: TrackPlayStatistics = {
  trackId: 1,
  title: "Song",
  artist: "Artist",
  album: "Album",
  albumArtist: "Artist",
  playCount: 1,
};
const scopes: Vue.EffectScope[] = [];
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function harness(desktop = true) {
  const events = new Map<string, () => void>();
  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  const requests: Array<ReturnType<typeof deferred<TrackPlayStatistics[]>>> = [];
  const notices: unknown[] = [];
  let mount = async () => {};
  let dispose = () => {};
  let enabled = true;
  const { useStatistics } = evaluateModule<{
    useStatistics: (albums: () => AlbumSummary[]) => Statistics;
  }>(output, {
    vue: {
      ...Vue,
      onMounted: (callback: typeof mount) => {
        mount = callback;
      },
      onUnmounted: (callback: () => void) => {
        dispose = callback;
      },
    },
    "@tauri-apps/api/core": {
      isTauri: () => desktop,
      invoke: () => {
        const request = deferred<TrackPlayStatistics[]>();
        requests.push(request);
        return request.promise;
      },
    },
    "@tauri-apps/api/event": {
      listen: async (event: string, callback: () => void) => {
        events.set(event, callback);
        return () => events.delete(event);
      },
    },
    "@/features/settings/api": {
      createSettingsApi: () => ({ get: async () => ({ showPlaybackStatistics: enabled }) }),
    },
    "@/features/library/events": { LIBRARY_CHANGED_EVENT: "library" },
    "@/features/tracks/events": { TRACKS_CHANGED_EVENT: "tracks" },
    "@/features/settings/events": { SETTINGS_CHANGED_EVENT: "settings" },
    "@/shared/notifications/center": { notify: (input: unknown) => notices.push(input) },
  });
  const albums = Vue.ref([album]);
  const scope = Vue.effectScope();
  scopes.push(scope);
  const statistics = scope.run(() => useStatistics(() => albums.value))!;
  void mount();
  return {
    statistics,
    albums,
    requests,
    events,
    notices,
    dispose,
    target,
    setEnabled: (value: boolean) => {
      enabled = value;
      target.dispatchEvent(new Event("settings"));
    },
  };
}

it("filters the complete album scope before taking the first ten tracks, using album artist identity", async () => {
  const h = harness();
  await flush();
  h.requests[0]!.resolve([
    { ...track, trackId: 99, albumArtist: "Other", playCount: 100 },
    ...Array.from({ length: 15 }, (_, i) => ({ ...track, trackId: i + 1, playCount: 20 - i })),
  ]);
  await flush();
  expect(h.statistics.tracks.value.map((item) => item.trackId)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ]);
  h.events.get("playback-statistics-changed")!();
  h.requests[1]!.resolve([{ ...track, playCount: 30 }]);
  await flush();
  expect(h.statistics.tracks.value[0]!.playCount).toBe(30);
  h.dispose();
  expect(h.events.size).toBe(0);
});

it("clears old scope immediately and ignores stale responses after changing albums", async () => {
  const h = harness();
  await flush();
  h.albums.value = [{ albumArtist: null, album: null, year: null }];
  await flush();
  h.requests[1]!.resolve([{ ...track, album: null, albumArtist: null, playCount: 4 }]);
  await flush();
  h.requests[0]!.resolve([track]);
  await flush();
  expect(h.statistics.tracks.value[0]!.playCount).toBe(4);
  h.albums.value = [];
  await flush();
  expect(h.statistics.tracks.value).toEqual([]);
  expect(h.statistics.isLoading.value).toBe(false);
  h.dispose();
});

it("stops queries when disabled and refreshes on enabling or membership changes", async () => {
  const h = harness();
  await flush();
  h.setEnabled(false);
  await flush();
  h.requests[0]!.resolve([track]);
  await flush();
  expect(h.statistics.visible.value).toBe(false);
  expect(h.statistics.tracks.value).toEqual([]);
  h.events.get("playback-statistics-changed")!();
  expect(h.requests).toHaveLength(1);
  h.setEnabled(true);
  await flush();
  h.requests[1]!.resolve([track]);
  await flush();
  h.target.dispatchEvent(new Event("library"));
  h.requests[2]!.resolve([]);
  await flush();
  expect(h.statistics.tracks.value).toEqual([]);
  h.dispose();
});

it("reports read/save failures and ignores responses after disposal", async () => {
  const h = harness();
  await flush();
  h.requests[0]!.resolve([track]);
  await flush();
  h.events.get("playback-statistics-changed")!();
  h.requests[1]!.reject(new Error("unavailable"));
  await flush();
  expect(h.statistics.loadFailed.value).toBe(true);
  expect(h.statistics.tracks.value).toEqual([track]);
  h.events.get("playback-statistics-save-failed")!();
  expect(h.notices).toHaveLength(2);
  h.events.get("playback-statistics-changed")!();
  h.dispose();
  h.requests[2]!.resolve([]);
  await flush();
  expect(h.statistics.tracks.value).toEqual([track]);
});

it("does not invoke native APIs in browser preview", async () => {
  const h = harness(false);
  await flush();
  expect(h.requests).toHaveLength(0);
  expect(h.events.size).toBe(0);
  h.dispose();
});
