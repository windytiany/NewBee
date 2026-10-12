import { computed, onScopeDispose, reactive, watch } from "vue";
import type { Ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { createInboxApi, INBOX_CHANGED_EVENT } from "@/features/inbox/api";
import type { InboxResult, InboxTrack } from "@/features/inbox/api";
import type { ArtistSummary, LibraryGrouping } from "@/features/library/types";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import { FILES_CHANGED_EVENT } from "@/features/metadata/events";
import { usePlaybackSession } from "@/features/playback/session";
import type { PlaybackDisplayTrack } from "@/features/playback/types";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { t } from "@/shared/i18n/locale";

type InboxOptions = {
  api: ReturnType<typeof createInboxApi>;
  session: Pick<
    ReturnType<typeof usePlaybackSession>,
    "playTracks" | "addTracksToNext" | "addTracksToQueueEnd"
  >;
  changed: () => void;
};
export function createInbox(options: InboxOptions) {
  const state = reactive({
    tracks: [] as InboxTrack[],
    loading: false,
    pending: false,
    error: "",
    results: [] as InboxResult[],
    grouping: "albumArtist" as LibraryGrouping,
    artist: null as ArtistSummary | null,
  });
  let version = 0;
  function report(results: InboxResult[]) {
    const failed = results.filter((result) => !result.success);
    for (const result of failed)
      logger.warn("inbox", "file_failed", result.error, { path: result.path });
    if (failed.length)
      notify({
        type: "warning",
        message: t("{count} 个文件处理失败", { count: failed.length }),
        key: "inbox-files",
      });
  }
  async function refresh() {
    const request = ++version;
    state.loading = true;
    state.error = "";
    try {
      const read = await options.api.read();
      if (request !== version) return;
      state.tracks = read.tracks;
      report(read.failures);
    } catch (error) {
      if (request !== version) return;
      state.error = t("读取 Inbox 失败");
      logger.error("inbox", "read_failed", error);
      notify({ type: "error", message: state.error, key: "inbox-read" });
    } finally {
      if (request === version) state.loading = false;
    }
  }
  const artists = computed<ArtistSummary[]>(() => {
    const groups = new Map<string | null, Set<string | null>>();
    for (const track of state.tracks) {
      const artist = track[state.grouping];
      const albums = groups.get(artist) ?? new Set<string | null>();
      albums.add(track.album);
      groups.set(artist, albums);
    }
    return [...groups]
      .map(([artist, albums]) => ({ artist, albumCount: albums.size }))
      .sort((a, b) => (a.artist ?? "").localeCompare(b.artist ?? ""));
  });
  const visibleTracks = computed(() =>
    state.tracks.filter(
      (track) => state.artist === null || track[state.grouping] === state.artist.artist,
    ),
  );
  function playback(track: InboxTrack): PlaybackDisplayTrack {
    return {
      trackId: null,
      path: track.path,
      rowKey: `inbox:${track.path}`,
      title: track.title,
      album: track.album,
      durationMs: track.durationMs,
    };
  }
  function play(path: string) {
    return options.session.playTracks(visibleTracks.value.map(playback), `inbox:${path}`);
  }
  function targets(paths: string[]) {
    const selected = new Set(paths);
    return state.tracks.filter((track) => selected.has(track.path)).map(playback);
  }
  async function remove(paths: string[]) {
    if (state.pending) return;
    state.pending = true;
    try {
      await options.api.remove(paths);
      state.tracks = state.tracks.filter((track) => !paths.includes(track.path));
    } catch (error) {
      logger.error("inbox", "remove_failed", error);
      notify({ type: "error", message: t("移除失败"), key: "inbox-remove" });
    } finally {
      state.pending = false;
    }
  }
  async function ingest(paths: string[]) {
    if (state.pending) return;
    state.pending = true;
    state.results = [];
    try {
      const results = await options.api.ingest(paths);
      state.results = results;
      const succeeded = new Set(
        results.filter((result) => result.success).map((result) => result.path),
      );
      state.tracks = state.tracks.filter((track) => !succeeded.has(track.path));
      report(results);
      if (succeeded.size) {
        options.changed();
        notify({
          type: "success",
          message: t("已加入音乐库：{count} 首", { count: succeeded.size }),
          key: "inbox-ingest",
        });
      }
    } catch (error) {
      logger.error("inbox", "ingest_failed", error);
      notify({ type: "error", message: t("添加到音乐库失败"), key: "inbox-ingest" });
    } finally {
      state.pending = false;
    }
  }
  return {
    state,
    artists,
    visibleTracks,
    refresh,
    play,
    remove,
    ingest,
    addNext: (paths: string[]) => options.session.addTracksToNext(targets(paths)),
    addEnd: (paths: string[]) => options.session.addTracksToQueueEnd(targets(paths)),
    selectGrouping: (grouping: LibraryGrouping) => {
      state.grouping = grouping;
      state.artist = null;
    },
  };
}
export function useInbox(active: Ref<boolean>) {
  const inbox = createInbox({
    api: createInboxApi(),
    session: usePlaybackSession(),
    changed: () => globalThis.window.dispatchEvent(new globalThis.Event(LIBRARY_CHANGED_EVENT)),
  });
  function refresh() {
    if (active.value && isTauri()) void inbox.refresh();
  }
  watch(
    active,
    (active) => {
      if (active) refresh();
    },
    { immediate: true },
  );
  globalThis.window.addEventListener(INBOX_CHANGED_EVENT, refresh);
  globalThis.window.addEventListener(FILES_CHANGED_EVENT, refresh);
  onScopeDispose(() => {
    globalThis.window.removeEventListener(INBOX_CHANGED_EVENT, refresh);
    globalThis.window.removeEventListener(FILES_CHANGED_EVENT, refresh);
  });
  return inbox;
}
