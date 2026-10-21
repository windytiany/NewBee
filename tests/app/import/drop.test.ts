import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import type { useDropImport } from "@/app/import/useDropImport";
import type { NotificationInput } from "@/shared/notifications/center";
import type { TrackRegistrationResult, TrackDetails } from "@/features/tracks/types";
import type { PlaybackDisplayTrack } from "@/features/playback/types";
import { evaluateSource, transpileScript } from "../../support/module/loader";
import { playbackFixture } from "../../support/playback/session";

const output = transpileScript(await Bun.file("src/app/import/useDropImport.ts").text());
const originals = ["document", "MutationObserver"].map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
);
afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
const track: TrackDetails = {
  id: 7,
  path: "song.wav",
  title: "song.wav",
  artist: null,
  album: null,
  albumArtist: null,
  releaseDate: null,
  discNumber: null,
  trackNumber: null,
  discTotal: null,
  trackTotal: null,
  durationMs: null,
  codec: null,
  sampleRateHz: null,
  bitrateKbps: null,
  channels: null,
};
function createDrop({
  desktop = true,
  validate = async () => ["song.wav"],
  preview,
  subscription,
  directories = async () => [],
  createPlaylist = async () => 12,
  registration = async () =>
    [{ status: "registered", track, needsMetadata: true }] as TrackRegistrationResult[],
  append = async () => true,
  playlistAppend = async (ids: readonly number[]) =>
    ids.map((trackId, index) => ({
      index,
      trackId,
      status: "added" as const,
      playlistItemId: index + 1,
    })),
}: {
  desktop?: boolean;
  validate?: () => Promise<string[]>;
  preview?: () => Promise<{ hasFiles: boolean; hasDirectories: boolean }>;
  subscription?: Promise<() => void>;
  directories?: () => Promise<{ path: string; name: string }[]>;
  createPlaylist?: (name: string) => Promise<number>;
  registration?: () => Promise<TrackRegistrationResult[]>;
  append?: (tracks: readonly Omit<PlaybackDisplayTrack, "rowKey">[]) => Promise<boolean>;
  playlistAppend?: (
    ids: readonly number[],
  ) => Promise<import("@/features/playlist/types").PlaylistAppendResult[]>;
} = {}) {
  const region = Vue.ref<string | null>("Library");
  const playlistId = Vue.ref(3);
  const importing = Vue.ref(false);
  const inboxPending = Vue.ref(false);
  const scanning = Vue.ref(false);
  const calls: Array<[string, unknown]> = [];
  const notices: NotificationInput[] = [];
  let modal = false;
  let mount: () => Promise<void> = async () => {};
  let unmount = () => {};
  let mutate = () => {};
  let listener: (event: { payload: DragDropEvent }) => void = () => {};
  let scaleListener: (event: { payload: { scaleFactor: number } }) => void = () => {};
  let stops = 0;
  let disconnects = 0;
  let registrations = 0;
  let scale = 2;
  const coordinates: number[][] = [];
  const bounds = Vue.ref({ left: 24, top: 12, width: 400, height: 600 });
  const element = {
    getAttribute: (name: string) =>
      name === "data-local-drop" ? region.value : String(playlistId.value),
    getBoundingClientRect: () => bounds.value,
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body: {},
      querySelector: () => (modal ? {} : null),
      elementsFromPoint: (x: number, y: number) => {
        coordinates.push([x, y]);
        return region.value ? [{ closest: () => element }] : [];
      },
    },
  });
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        mutate = callback;
      }
      observe() {}
      disconnect() {
        disconnects += 1;
      }
    },
  });
  const module = evaluateSource<{ useDropImport: typeof useDropImport }>(output, {
    vue: {
      ...Vue,
      onMounted: (callback: typeof mount) => {
        mount = callback;
      },
      onUnmounted: (callback: typeof unmount) => {
        unmount = callback;
      },
    },
    "@tauri-apps/api/core": {
      isTauri: () => desktop,
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        if (command === "preview_local_drop") {
          if (preview) return (await preview()) as T;
          const [files, folders] = await Promise.all([validate(), directories()]);
          return { hasFiles: files.length > 0, hasDirectories: folders.length > 0 } as T;
        }
        if (command === "readable_audio_files") return (await validate()) as T;
        if (command === "playlist_directories") return (await directories()) as T;
        calls.push([command, args]);
        if (command === "create_playlist") return (await createPlaylist(args?.name as string)) as T;
        if (command === "register_local_tracks") return (await registration()) as T;
        if (command === "get_tracks") return [{ ...track, title: "Confirmed" }] as T;
        if (command === "append_playlist_tracks")
          return (await playlistAppend(args?.trackIds as number[])) as T;
        return undefined as T;
      },
    },
    "@tauri-apps/api/window": {
      getCurrentWindow: () => ({
        scaleFactor: async () => scale,
        onScaleChanged: async (callback: typeof scaleListener) => {
          scaleListener = callback;
          return () => {
            stops += 1;
          };
        },
      }),
    },
    "@tauri-apps/api/webview": {
      getCurrentWebview: () => ({
        onDragDropEvent: async (callback: typeof listener) => {
          registrations += 1;
          listener = callback;
          return (
            subscription ??
            (() => {
              stops += 1;
            })
          );
        },
      }),
    },
    "@/features/library/import/useFileImport": {
      useLibraryFileImport: () => ({
        isImporting: importing,
        importPaths: async (paths: string[]) => {
          calls.push(["Library", paths]);
        },
      }),
    },
    "@/features/inbox/useImport": {
      useInboxImport: () => ({
        pending: inboxPending,
        importPaths: async (paths: string[]) => {
          calls.push(["Inbox", paths]);
        },
      }),
    },
    "@/features/library/synchronization/useScan": {
      useLibrarySynchronization: () => ({ isScanning: scanning }),
    },
    "@/features/playback/session": {
      usePlaybackSession: () => ({
        addTracksToQueueEnd: async (tracks: readonly Omit<PlaybackDisplayTrack, "rowKey">[]) => {
          calls.push(["queue", tracks]);
          return append(tracks);
        },
        updateTrackMetadata: async (tracks: unknown) => {
          calls.push(["metadata", tracks]);
        },
      }),
    },
    "@/features/tracks/events": {
      reportTracksChanged: (ids: readonly number[]) => {
        calls.push(["changed", ids]);
      },
    },
    "@/features/playlist/events": {
      reportPlaylistChanged: (playlistId: number) => calls.push(["playlistChanged", playlistId]),
    },
    "@/shared/notifications/center": {
      notify: (notice: NotificationInput) => notices.push(notice),
    },
    "@/shared/logging/logger": { logger: { error: () => {} } },
  });
  const controller = module.useDropImport();
  return {
    ...controller,
    mount,
    unmount,
    region,
    playlistId,
    importing,
    inboxPending,
    scanning,
    calls,
    notices,
    coordinates,
    bounds,
    counts: () => ({ stops, disconnects, registrations }),
    setModal: (value: boolean) => {
      modal = value;
      mutate();
    },
    setScale: (value: number) => {
      scale = value;
      scaleListener({ payload: { scaleFactor: value } });
    },
    emit: async (type: "enter" | "over" | "drop" | "leave", paths = ["song.wav"]) => {
      listener({
        payload:
          type === "leave"
            ? { type }
            : type === "over"
              ? { type, position: new PhysicalPosition(100, 60) }
              : { type, paths, position: new PhysicalPosition(100, 60) },
      });
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}

it("routes by hit region, converts physical coordinates and updates scale without guessing a page", async () => {
  const drop = createDrop();
  await drop.mount();
  await drop.emit("enter");
  expect(drop.highlight.value).toEqual({
    left: "24px",
    top: "12px",
    width: "400px",
    height: "600px",
  });
  expect(drop.coordinates[drop.coordinates.length - 1]).toEqual([50, 30]);
  drop.region.value = "Inbox";
  drop.bounds.value = { left: 20, top: 10, width: 250, height: 360 };
  await drop.emit("over");
  expect(drop.highlight.value).toEqual({
    left: "20px",
    top: "10px",
    width: "250px",
    height: "360px",
  });
  await drop.emit("drop");
  expect(drop.calls).toEqual([["Inbox", ["song.wav"]]]);
  drop.setScale(1.25);
  await drop.emit("enter");
  expect(drop.coordinates[drop.coordinates.length - 1]).toEqual([80, 48]);
  drop.region.value = "Library";
  await drop.emit("drop");
  drop.region.value = null;
  await drop.emit("enter");
  expect(drop.highlight.value).toBeNull();
  drop.region.value = "playlist";
  await drop.emit("over");
  expect(drop.highlight.value).toEqual({
    left: "20px",
    top: "10px",
    width: "250px",
    height: "360px",
  });
  drop.region.value = null;
  await drop.emit("over");
  expect(drop.highlight.value).toBeNull();
  await drop.emit("drop");
  expect(drop.calls).toHaveLength(2);
  drop.unmount();
  expect(drop.highlight.value).toBeNull();
  expect(drop.counts()).toMatchObject({ stops: 2, disconnects: 1 });
});
it("highlights folders across drop regions before recursive audio discovery finishes", async () => {
  const discovery = deferred<string[]>();
  const drop = createDrop({
    validate: () => discovery.promise,
    preview: async () => ({ hasFiles: false, hasDirectories: true }),
    directories: async () => [{ path: "/Music", name: "Music" }],
  });
  await drop.mount();
  await drop.emit("enter", ["/Music"]);
  try {
    for (const kind of ["Library", "Inbox", "queue", "playlist", "playlists"]) {
      drop.region.value = kind;
      await drop.emit("over");
      expect(drop.highlight.value).not.toBeNull();
    }
  } finally {
    drop.unmount();
    discovery.resolve(["song.wav"]);
  }
});

it("creates a named playlist per sidebar folder and registers each folder recursively", async () => {
  let nextId = 12;
  const drop = createDrop({
    directories: async () => [
      { path: "/music/Album", name: "Album" },
      { path: "/music/Other", name: "Other" },
    ],
    createPlaylist: async () => nextId++,
  });
  await drop.mount();
  drop.region.value = "playlists";
  await drop.emit("enter", ["/music/Album", "/music/Other"]);
  expect(drop.highlight.value).not.toBeNull();
  await drop.emit("drop", ["/music/Album", "/music/Other"]);
  for (let i = 0; i < 60; i++) await Promise.resolve();
  expect(drop.calls.filter(([name]) => name === "create_playlist")).toEqual([
    ["create_playlist", { name: "Album" }],
    ["create_playlist", { name: "Other" }],
  ]);
  expect(drop.calls.filter(([name]) => name === "register_local_tracks")).toEqual([
    ["register_local_tracks", { paths: ["/music/Album"] }],
    ["register_local_tracks", { paths: ["/music/Other"] }],
  ]);
  for (const playlistId of [12, 13]) {
    expect(drop.calls).toContainEqual(["append_playlist_tracks", { playlistId, trackIds: [7] }]);
    expect(drop.calls).toContainEqual(["playlistChanged", playlistId]);
  }
  expect(drop.notices).toEqual([]);
  drop.unmount();
});

it("moving audio between sidebar and browser changes feedback and only the browser appends it", async () => {
  const drop = createDrop();
  await drop.mount();
  await drop.emit("enter");
  drop.region.value = "playlists";
  await drop.emit("over");
  expect(drop.highlight.value).toBeNull();
  await drop.emit("drop");
  expect(drop.calls).toEqual([]);
  drop.region.value = "playlist";
  await drop.emit("enter");
  expect(drop.highlight.value).not.toBeNull();
  await drop.emit("drop");
  expect(drop.calls).toContainEqual(["append_playlist_tracks", { playlistId: 3, trackIds: [7] }]);
  expect(drop.calls.some(([name]) => name === "create_playlist")).toBe(false);
  drop.unmount();
});

it("creates empty folder playlists and switches folder feedback without re-entering", async () => {
  const drop = createDrop({
    validate: async () => [],
    directories: async () => [{ path: "/Empty", name: "Empty" }],
    registration: async () => [],
  });
  await drop.mount();
  await drop.emit("enter", ["/Empty"]);
  expect(drop.highlight.value).not.toBeNull();
  drop.region.value = "playlists";
  await drop.emit("over");
  expect(drop.highlight.value).not.toBeNull();
  await drop.emit("drop", ["/Empty"]);
  expect(drop.calls).toContainEqual(["create_playlist", { name: "Empty" }]);
  expect(drop.calls).toContainEqual(["playlistChanged", 12]);
  expect(drop.calls.some(([name]) => name === "append_playlist_tracks")).toBe(false);
  drop.unmount();
});

it("continues creating later folders after a playlist creation failure", async () => {
  const drop = createDrop({
    directories: async () => [
      { path: "/Bad", name: "Bad" },
      { path: "/Good", name: "Good" },
    ],
    createPlaylist: async (name) => {
      if (name === "Bad") throw new Error("database busy");
      return 12;
    },
  });
  await drop.mount();
  drop.region.value = "playlists";
  await drop.emit("drop", ["/Bad", "/Good"]);
  for (let i = 0; i < 60; i++) await Promise.resolve();
  expect(drop.calls).toContainEqual(["playlistChanged", 12]);
  expect(drop.calls).toContainEqual(["register_local_tracks", { paths: ["/Good"] }]);
  expect(drop.notices.map(({ message }) => message)).toEqual(["创建歌单失败"]);
  drop.unmount();
});

it("blocks modal drops and reports busy import/scan without executing", async () => {
  const drop = createDrop();
  await drop.mount();
  await drop.emit("enter");
  drop.setModal(true);
  expect(drop.highlight.value).toBeNull();
  await drop.emit("drop");
  expect(drop.calls).toEqual([]);
  drop.setModal(false);
  for (const pending of [drop.importing, drop.inboxPending, drop.scanning]) {
    await drop.emit("enter");
    pending.value = true;
    expect(drop.highlight.value).toBeNull();
    await drop.emit("drop");
    pending.value = false;
  }
  expect(drop.calls).toEqual([]);
  expect(drop.notices.map((notice) => notice.message)).toEqual(Array(3).fill("操作进行中"));
  drop.unmount();
});
it("captures playlist ID before registration and refreshes after appending even if confirmation was early", async () => {
  const registered = deferred<TrackRegistrationResult[]>();
  const drop = createDrop({ registration: () => registered.promise });
  await drop.mount();
  drop.region.value = "playlist";
  await drop.emit("drop");
  drop.playlistId.value = 99;
  drop.region.value = "queue";
  await drop.emit("drop");
  expect(drop.notices[drop.notices.length - 1]?.message).toBe("操作进行中");
  registered.resolve([
    { status: "registered", track, needsMetadata: true },
    { status: "failed", path: "bad", error: "unreadable" },
  ]);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(drop.calls).toContainEqual(["append_playlist_tracks", { trackIds: [7], playlistId: 3 }]);
  expect(drop.calls.findIndex(([name]) => name === "get_tracks")).toBeGreaterThan(
    drop.calls.findIndex(([name]) => name === "append_playlist_tracks"),
  );
  expect(drop.notices[drop.notices.length - 1]?.message).toBe("1 个文件登记失败");
  drop.unmount();
});
it("queue drop uses IDs only and refreshes the DB snapshot after append", async () => {
  const drop = createDrop();
  await drop.mount();
  drop.region.value = "queue";
  await drop.emit("drop");
  expect(drop.calls).toContainEqual([
    "queue",
    [{ trackId: 7, title: "song.wav", album: null, durationMs: null }],
  ]);
  expect(drop.calls[drop.calls.length - 1]).toEqual([
    "metadata",
    [{ ...track, title: "Confirmed" }],
  ]);
  drop.unmount();
});
it("first and repeated queue drops append through the session without requesting playback or showing failures", async () => {
  const fixture = playbackFixture();
  await fixture.session.ready;
  const drop = createDrop({ append: fixture.session.addTracksToQueueEnd });
  await drop.mount();
  drop.region.value = "queue";
  for (let count = 1; count <= 2; count++) {
    await drop.emit("drop");
    expect(fixture.session.state.displayedTracks.value).toHaveLength(count);
    expect(fixture.calls).toEqual(["snapshot", ...Array(count).fill("add")]);
    expect(fixture.session.state.currentPlaybackId.value).toBeNull();
    expect(fixture.session.state.playbackStatus.value.isPlaying).toBe(false);
    expect(fixture.session.state.playbackError.value).toBe("");
    expect(fixture.session.state.queuePlaybackError.value).toBe("");
    expect(drop.notices).toEqual([]);
  }
  drop.unmount();
  fixture.session.dispose();
});

it("reports append failure separately from registration and leaves existing destinations untouched on all failure", async () => {
  const drop = createDrop({ append: async () => false });
  await drop.mount();
  drop.region.value = "queue";
  await drop.emit("drop");
  expect(drop.notices.map((notice) => notice.message)).toEqual(["曲目已登记，目标追加失败"]);
  drop.unmount();
  const failed = createDrop({
    registration: async () => [{ status: "failed", path: "bad", error: "bad" }],
  });
  await failed.mount();
  failed.region.value = "playlist";
  await failed.emit("drop");
  expect(failed.calls.map(([name]) => name)).toEqual(["register_local_tracks"]);
  failed.unmount();
});
it("cleans up invalid or stale feedback after leave/drop and ignores empty paths", async () => {
  const invalid = createDrop({ validate: async () => [] });
  await invalid.mount();
  await invalid.emit("enter");
  expect(invalid.highlight.value).toBeNull();
  invalid.unmount();
  for (const ending of ["leave", "drop"] as const) {
    const validation = deferred<string[]>();
    const drop = createDrop({ validate: () => validation.promise });
    await drop.mount();
    await drop.emit("enter");
    await drop.emit(ending, []);
    validation.resolve(["song.wav"]);
    await Promise.resolve();
    expect(drop.highlight.value).toBeNull();
    expect(drop.calls).toEqual([]);
    drop.unmount();
  }
});
it("releases subscriptions that finish registering after unmount", async () => {
  let stops = 0;
  const subscription = deferred<() => void>();
  const drop = createDrop({ subscription: subscription.promise });
  const mounted = drop.mount();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  drop.unmount();
  subscription.resolve(() => {
    stops += 1;
  });
  await mounted;
  await drop.emit("drop");
  expect(stops).toBe(1);
  expect(drop.calls).toEqual([]);
});
it("does not access native or DOM APIs in browser preview", async () => {
  const drop = createDrop({ desktop: false });
  await drop.mount();
  expect(drop.counts().registrations).toBe(0);
  drop.unmount();
});

it("playlist partial append preserves successful registration and reports actual added and failed counts", async () => {
  const drop = createDrop({
    registration: async () => [
      { status: "registered", track, needsMetadata: true },
      { status: "registered", track: { ...track, id: 8 }, needsMetadata: true },
    ],
    playlistAppend: async () => [
      { index: 0, trackId: 7, status: "added", playlistItemId: 20 },
      { index: 1, trackId: 8, status: "failed", error: "missing track" },
    ],
  });
  await drop.mount();
  drop.region.value = "playlist";
  await drop.emit("drop");
  expect(drop.calls).toContainEqual(["playlistChanged", 3]);
  expect(drop.calls).toContainEqual(["changed", [7, 8]]);
  expect(drop.calls).toContainEqual(["get_tracks", { trackIds: [7, 8] }]);
  expect(drop.notices.map((notice) => notice.message)).toEqual([
    "曲目已登记，已添加 1 首，1 首追加失败",
  ]);
  expect(drop.calls.filter(([command]) => command === "append_playlist_tracks")).toHaveLength(1);
  drop.unmount();
});
