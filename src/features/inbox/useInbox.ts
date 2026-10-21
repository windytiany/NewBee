import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { watchActivity } from "@/shared/lifecycle/activity";
import type { Ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { createInboxApi, INBOX_CHANGED_EVENT } from "@/features/inbox/api";
import type { InboxResult, InboxTrack } from "@/features/inbox/api";
import type { ArtistSummary, ArtistGrouping } from "@/features/artists/types";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import { useTrackReread } from "@/features/tracks/useReread";
import { TRACKS_CHANGED_EVENT, type TracksChange } from "@/features/tracks/events";
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
  reread: ReturnType<typeof useTrackReread>;
};
export function createInbox(options: InboxOptions) {
  const pending = ref(false);
  watchActivity(pending);
  const state = reactive({
    tracks: [] as InboxTrack[],
    loading: false,
    pending: computed(() => pending.value || options.reread.pending.value),
    error: "",
    results: [] as InboxResult[],
    grouping: "albumArtist" as ArtistGrouping,
    artist: null as ArtistSummary | null,
  });
  let version = 0;
  function report(results: InboxResult[]) {
    const failed = results.filter((result) => !result.success);
    for (const result of failed)
      logger.warn("inbox", "file_failed", result.error, {
        path: result.path,
        trackId: result.trackId,
      });
    if (failed.length)
      notify({
        type: "warning",
        message: t("{count} 首处理失败。无法完成操作。", { count: failed.length }),
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
      trackId: track.id,
      rowKey: `inbox:${track.id}`,
      title: track.title,
      album: track.album,
      durationMs: track.durationMs,
    };
  }
  function play(id: number, orderedIds: readonly number[]) {
    const visible = visibleTracks.value;
    const availableIds = new Set(visible.map((track) => track.id));
    if (
      state.loading ||
      state.pending ||
      !orderedIds.includes(id) ||
      orderedIds.length !== availableIds.size ||
      new Set(orderedIds).size !== availableIds.size ||
      orderedIds.some((id) => !availableIds.has(id))
    )
      return false;
    return options.session.playTracks(targets(orderedIds, visible), `inbox:${id}`);
  }
  function targets(ids: readonly number[], source: readonly InboxTrack[]) {
    const tracks = new Map(source.map((track) => [track.id, track]));
    return [...new Set(ids)].flatMap((id) => {
      const track = tracks.get(id);
      return track ? [playback(track)] : [];
    });
  }
  async function reread(trackIds: readonly number[] = state.tracks.map((track) => track.id)) {
    if (state.pending || state.loading) return;
    pending.value = true;
    try {
      const outcome = await options.reread.reread(trackIds);
      if (!outcome) return;
      for (const result of outcome.results) {
        if (!result.databaseUpdated || result.error)
          logger.warn("inbox", "reread_failed", result.error, {
            trackId: result.trackId,
            kind: "scan",
            path: state.tracks.find((track) => track.id === result.trackId)?.path ?? null,
          });
      }
      const succeeded = new Set(
        outcome.results.filter((result) => result.databaseUpdated).map((result) => result.trackId),
      );
      if (!succeeded.size) return outcome;
      try {
        const read = await options.api.read();
        const snapshots = new Map(read.tracks.map((track) => [track.id, track]));
        state.tracks = state.tracks.map((track) =>
          succeeded.has(track.id) ? (snapshots.get(track.id) ?? track) : track,
        );
      } catch (error) {
        logger.error("inbox", "reread_refresh_failed", error, { count: trackIds.length });
        if (
          !outcome.refreshError &&
          outcome.results.every((result) => result.databaseUpdated && !result.error)
        )
          notify({ type: "warning", message: t("曲目信息刷新失败"), key: "inbox-read" });
        return { ...outcome, refreshError: error instanceof Error ? error.message : String(error) };
      }
      return outcome;
    } finally {
      pending.value = false;
    }
  }
  async function remove(trackIds: number[]) {
    if (state.pending) return;
    pending.value = true;
    try {
      await options.api.remove(trackIds);
      state.tracks = state.tracks.filter((track) => !trackIds.includes(track.id));
    } catch (error) {
      logger.error("inbox", "remove_failed", error);
      notify({ type: "error", message: t("移除失败。无法更新 Inbox。"), key: "inbox-remove" });
    } finally {
      pending.value = false;
    }
  }
  async function ingest(trackIds: number[]) {
    if (state.pending) return;
    pending.value = true;
    state.results = [];
    try {
      const results = await options.api.ingest(trackIds);
      state.results = results;
      const succeeded = new Set(
        results.filter((result) => result.success).map((result) => result.trackId),
      );
      state.tracks = state.tracks.filter((track) => !succeeded.has(track.id));
      report(results);
      if (succeeded.size) options.changed();
    } catch (error) {
      logger.error("inbox", "ingest_failed", error);
      notify({
        type: "error",
        message: t("添加到音乐库失败。无法完成扫描。"),
        key: "inbox-ingest",
      });
    } finally {
      pending.value = false;
    }
  }
  return {
    state,
    artists,
    visibleTracks,
    refresh,
    play,
    reread,
    remove,
    ingest,
    addNext: (ids: number[]) =>
      state.pending ? false : options.session.addTracksToNext(targets(ids, state.tracks)),
    addEnd: (ids: number[]) =>
      state.pending ? false : options.session.addTracksToQueueEnd(targets(ids, state.tracks)),
    selectGrouping: (grouping: ArtistGrouping) => {
      state.grouping = grouping;
      state.artist = null;
    },
  };
}
export function useInbox(active: Ref<boolean>) {
  const inbox = createInbox({
    api: createInboxApi(),
    reread: useTrackReread(),
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
  function onTracksChanged(event: Event) {
    const { trackIds } = (event as CustomEvent<TracksChange>).detail;
    if (trackIds && !inbox.state.tracks.some((track) => trackIds.includes(track.id))) return;
    refresh();
  }
  globalThis.window.addEventListener(INBOX_CHANGED_EVENT, refresh);
  globalThis.window.addEventListener(TRACKS_CHANGED_EVENT, onTracksChanged);
  onScopeDispose(() => {
    globalThis.window.removeEventListener(INBOX_CHANGED_EVENT, refresh);
    globalThis.window.removeEventListener(TRACKS_CHANGED_EVENT, onTracksChanged);
  });
  return inbox;
}
