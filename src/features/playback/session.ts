import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { computed, readonly, ref, watch } from "vue";
import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import type { TrackLyrics } from "@/features/lyrics/types";
import type {
  PlaybackCommandInvoker,
  PlaybackDisplayTrack,
  PlaybackStatus,
  PlaybackTrack,
  TrackMetadataUpdate,
} from "@/features/playback/types";

export type { PlaybackStatus } from "@/features/playback/types";
export const PLAYBACK_STATUS_POLL_INTERVAL_MS = 500;

export type PlaybackSessionSnapshot = {
  revision: number;
  structuralRevision: number;
  displayedTracks: PlaybackDisplayTrack[];
  currentRowKey: string | null;
  currentTrack: PlaybackTrack | null;
  currentPlaybackId: number | null;
  playbackStatus: PlaybackStatus;
  queuePlaybackError: string;
  playbackError: string;
  shuffleEnabled: boolean;
  repeatOneEnabled: boolean;
  canPlayPrevious: boolean;
  canPlayNext: boolean;
  skippedTrackIds: number[];
  volume: number;
  isEditing: boolean;
  isCommandPending: boolean;
};

export type QueueTrackRemovalResult =
  | { status: "not-found" | "removed" | "stop-unconfirmed" | "superseded" }
  | { status: "stop-failed" | "queue-error"; message: string };

type SessionCommand =
  | { action: "volume"; volume: number }
  | { action: "snapshot" | "previous" | "next" | "toggle" | "clear" | "beginSeeking" | "mute" }
  | {
      action: "playTracks";
      tracks: readonly PlaybackDisplayTrack[];
      startRowKey: string | null;
      allowSkipped: boolean;
    }
  | { action: "playItem"; rowKey: string }
  | { action: "seek"; positionMs: number; playbackId: number | null }
  | { action: "add"; tracks: readonly PlaybackDisplayTrack[]; next: boolean }
  | { action: "remove"; rowKeys: readonly string[] }
  | { action: "removeTrack"; trackId: number }
  | { action: "repeat" | "shuffle"; enabled: boolean }
  | { action: "beginEditing"; trackIds: readonly number[] }
  | { action: "endEditing"; token: number };

export type PlaybackSessionProgress = {
  revision: number;
  structuralRevision: number;
  playbackStatus: PlaybackStatus & { playbackId: number | null };
};

export type PlaybackSessionReply = {
  snapshot: PlaybackSessionSnapshot;
  applied: boolean;
  removal: QueueTrackRemovalResult | null;
  editToken: number | null;
};

export type PlaybackMetadataDelta = {
  revision: number;
  structuralRevision: number;
  displayedTracks: PlaybackDisplayTrack[];
  currentTrack: PlaybackTrack | null;
};

type SessionSubscriber = (
  receive: (snapshot: PlaybackSessionSnapshot) => void,
) => Promise<() => void>;
export type PlaybackSessionOptions = {
  invokeCommand?: PlaybackCommandInvoker;
  subscribe?: SessionSubscriber;
  subscribeMetadata?: (receive: (delta: PlaybackMetadataDelta) => void) => Promise<() => void>;
};

const emptySnapshot = (): PlaybackSessionSnapshot => ({
  revision: -1,
  structuralRevision: -1,
  displayedTracks: [],
  currentRowKey: null,
  currentTrack: null,
  currentPlaybackId: null,
  playbackStatus: {
    hasAudio: false,
    isPlaying: false,
    hasEnded: false,
    positionMs: 0,
    durationMs: 0,
  },
  queuePlaybackError: "",
  playbackError: "",
  shuffleEnabled: false,
  repeatOneEnabled: false,
  canPlayPrevious: false,
  canPlayNext: false,
  skippedTrackIds: [],
  volume: 50,
  isEditing: false,
  isCommandPending: false,
});

/** A versioned projection of the backend session, never a playback scheduler. */
export function createPlaybackSession(options: PlaybackSessionOptions = {}) {
  const invokeCommand = options.invokeCommand ?? invoke;
  const snapshot = ref(emptySnapshot());
  const requestsPending = ref(0);
  const statusPending = ref(false);
  const isSeeking = ref(false);
  const isTrackSkipPending = ref(false);
  const adapterError = ref("");
  const sidecarLyrics = ref<TrackLyrics | null>(null);
  let disposed = false;
  let unlisten: (() => void) | null = null;
  let unlistenMetadata: (() => void) | null = null;
  let refreshing: Promise<void> | null = null;
  const rows = new Map<string, { track: PlaybackDisplayTrack; revision: number }>();
  let currentMetadataRevision = -1;
  let sidecarRequest = 0;
  let seekingVersion = 0;
  let seekPlaybackId: number | null = null;
  let seekingRequest: Promise<PlaybackSessionReply> | null = null;

  function receive(next: PlaybackSessionSnapshot) {
    if (disposed || next.revision < snapshot.value.revision) return;
    if (isSeeking.value && next.currentPlaybackId !== seekPlaybackId) {
      isSeeking.value = false;
      seekingVersion += 1;
    }
    snapshot.value = next;
    rows.clear();
    for (const row of snapshot.value.displayedTracks)
      rows.set(row.rowKey, { track: row, revision: next.revision });
    currentMetadataRevision = next.revision;
    adapterError.value = "";
  }

  async function refreshSnapshot() {
    refreshing ??= request({ action: "snapshot" }, false)
      .then(() => {})
      .finally(() => {
        refreshing = null;
      });
    await refreshing;
  }

  async function receiveMetadata(delta: PlaybackMetadataDelta) {
    if (disposed) return;
    if (delta.structuralRevision !== snapshot.value.structuralRevision) {
      if (delta.structuralRevision > snapshot.value.structuralRevision) await refreshSnapshot();
      return;
    }
    for (const update of delta.displayedTracks) {
      const row = rows.get(update.rowKey);
      if (row && delta.revision > row.revision && row.track.trackId === update.trackId) {
        row.track.title = update.title;
        row.track.album = update.album;
        row.track.durationMs = update.durationMs;
        row.revision = delta.revision;
      }
    }
    if (delta.revision > currentMetadataRevision) {
      snapshot.value.currentTrack = delta.currentTrack;
      currentMetadataRevision = delta.revision;
    }
    snapshot.value.revision = Math.max(snapshot.value.revision, delta.revision);
  }

  async function request(command: SessionCommand, pending = true) {
    if (
      isSeeking.value &&
      [
        "playTracks",
        "playItem",
        "previous",
        "next",
        "toggle",
        "clear",
        "remove",
        "removeTrack",
        "beginEditing",
      ].includes(command.action)
    ) {
      isSeeking.value = false;
      seekingVersion += 1;
    }
    if (pending) requestsPending.value += 1;
    try {
      const reply = await invokeCommand<PlaybackSessionReply>("playback_session_command", {
        command,
      });
      receive(reply.snapshot);
      return reply;
    } finally {
      if (pending) requestsPending.value -= 1;
    }
  }

  async function refreshPlaybackStatus(): Promise<boolean> {
    if (statusPending.value || disposed) return false;
    statusPending.value = true;
    try {
      const progress = await invokeCommand<PlaybackSessionProgress>("playback_session_progress");
      if (disposed || progress.structuralRevision < snapshot.value.structuralRevision) return false;
      if (
        progress.structuralRevision > snapshot.value.structuralRevision ||
        progress.playbackStatus.playbackId !== snapshot.value.currentPlaybackId
      ) {
        await refreshSnapshot();
      } else {
        snapshot.value = { ...snapshot.value, playbackStatus: progress.playbackStatus };
      }
      return true;
    } catch (error) {
      logger.warn("playback", "status_unavailable", error);
      adapterError.value = t("播放状态读取失败");
      return false;
    } finally {
      statusPending.value = false;
    }
  }

  async function perform(command: SessionCommand, pending = true): Promise<boolean> {
    try {
      return (await request(command, pending)).applied;
    } catch (error) {
      logger.error("playback", "command_failed", error);
      adapterError.value = t("播放操作失败");
      await refreshPlaybackStatus();
      return false;
    }
  }

  const currentTrack = computed(() => snapshot.value.currentTrack);
  watch(
    () => [currentTrack.value?.trackId ?? null, snapshot.value.currentPlaybackId] as const,
    ([trackId, playbackId], previous) => {
      if (trackId === previous?.[0] && playbackId === previous?.[1]) return;
      // Editing detaches the audio instance, but retains the listening lyrics.
      if (trackId !== null && trackId === previous?.[0] && playbackId === null) return;
      const generation = ++sidecarRequest;
      sidecarLyrics.value = null;
      if (trackId === null || playbackId === null) return;
      const request = invokeCommand<TrackLyrics | null>("get_playback_sidecar_lyrics", { trackId });
      void request
        .then((lyrics) => {
          if (!disposed && generation === sidecarRequest) sidecarLyrics.value = lyrics;
        })
        .catch((error: unknown) =>
          logger.warn("lyrics", "sidecar_read_failed", error, { trackId }),
        );
    },
    { flush: "sync" },
  );

  const subscribe =
    options.subscribe ??
    (options.invokeCommand
      ? null
      : (receive: (snapshot: PlaybackSessionSnapshot) => void) =>
          listen<PlaybackSessionSnapshot>("playback-session-changed", ({ payload }) =>
            receive(payload),
          ));
  const ready = (async () => {
    if (subscribe) {
      try {
        const stop = await subscribe(receive);
        if (disposed) stop();
        else unlisten = stop;
      } catch (error) {
        logger.warn("playback", "subscription_failed", error);
      }
    }
    const subscribeMetadata =
      options.subscribeMetadata ??
      (options.invokeCommand
        ? null
        : (receive: (delta: PlaybackMetadataDelta) => void) =>
            listen<PlaybackMetadataDelta>("playback-session-metadata", ({ payload }) =>
              receive(payload),
            ));
    if (subscribeMetadata) {
      try {
        const stop = await subscribeMetadata((delta) => {
          void receiveMetadata(delta).catch((error: unknown) =>
            logger.warn("playback", "metadata_unavailable", error),
          );
        });
        if (disposed) stop();
        else unlistenMetadata = stop;
      } catch (error) {
        logger.warn("playback", "subscription_failed", error);
      }
    }
    try {
      await request({ action: "snapshot" }, false);
    } catch (error) {
      logger.warn("playback", "status_unavailable", error);
      adapterError.value = t("播放状态读取失败");
    }
  })();

  async function remove(command: SessionCommand): Promise<QueueTrackRemovalResult> {
    const reply = await request(command);
    if (reply.removal === null) throw new Error("Missing playback queue removal result");
    return reply.removal;
  }

  function beginSeeking() {
    if (isSeeking.value) return;
    isSeeking.value = true;
    seekingVersion += 1;
    seekPlaybackId = snapshot.value.currentPlaybackId;
    seekingRequest = request({ action: "beginSeeking" }, false);
    void seekingRequest.catch((error: unknown) => logger.warn("playback", "seek_failed", error));
  }

  async function seekTo(positionMs: number) {
    if (!isSeeking.value) return false;
    const version = seekingVersion;
    const playbackId = seekPlaybackId;
    try {
      await seekingRequest?.catch((error: unknown) =>
        logger.warn("playback", "seek_failed", error),
      );
      if (!isSeeking.value || version !== seekingVersion) return false;
      return await perform({ action: "seek", positionMs, playbackId });
    } finally {
      if (version === seekingVersion) {
        isSeeking.value = false;
        seekingRequest = null;
      }
    }
  }

  async function withMetadataEditing<T>(
    trackIds: readonly number[],
    save: () => Promise<T>,
  ): Promise<T> {
    requestsPending.value += 1;
    let token: number | null = null;
    try {
      const reply = await request({ action: "beginEditing", trackIds }, false);
      token = reply.editToken;
      if (token === null) throw new Error(t("未能确认播放文件已释放，请重试。"));
      return await save();
    } finally {
      let cleanupFailed = false;
      try {
        if (token !== null) await request({ action: "endEditing", token }, false);
      } catch (error) {
        // A completed file write remains completed even if releasing the lease fails.
        // Preserve the callback result/error and expose the playback failure separately.
        cleanupFailed = true;
        logger.error("playback", "editing_release_failed", error);
      } finally {
        requestsPending.value -= 1;
        await refreshPlaybackStatus();
        if (cleanupFailed) adapterError.value = t("播放操作失败");
      }
    }
  }

  const state = Object.freeze({
    volume: computed(() => snapshot.value.volume),
    sidecarLyrics: readonly(sidecarLyrics),
    playbackStatus: readonly(computed(() => snapshot.value.playbackStatus)),
    isPlaybackStatusSettled: computed(() => snapshot.value.revision >= 0 && !statusPending.value),
    playbackError: computed(() => adapterError.value || snapshot.value.playbackError),
    currentTrack: readonly(currentTrack),
    currentPlaybackId: computed(() => snapshot.value.currentPlaybackId),
    isPlaybackCommandPending: computed(
      () =>
        requestsPending.value > 0 || snapshot.value.isEditing || snapshot.value.isCommandPending,
    ),
    isSeeking: readonly(isSeeking),
    canStartRestoredQueue: computed(
      () => snapshot.value.currentPlaybackId === null && snapshot.value.currentRowKey !== null,
    ),
    displayedTracks: readonly(computed(() => snapshot.value.displayedTracks)),
    currentRowKey: computed(() => snapshot.value.currentRowKey),
    activeQueueRowKey: computed(() =>
      snapshot.value.currentPlaybackId !== null ? snapshot.value.currentRowKey : null,
    ),
    queuePlaybackError: computed(() => snapshot.value.queuePlaybackError),
    repeatOneEnabled: computed(() => snapshot.value.repeatOneEnabled),
    shuffleEnabled: computed(() => snapshot.value.shuffleEnabled),
    canPlayPrevious: computed(() => snapshot.value.canPlayPrevious),
    canPlayNext: computed(() => snapshot.value.canPlayNext),
    playbackStartError: computed(() => snapshot.value.queuePlaybackError),
    skippedTrackIds: readonly(computed(() => snapshot.value.skippedTrackIds)),
    isTrackSkipPending: readonly(isTrackSkipPending),
  });
  const add = (tracks: readonly Omit<PlaybackDisplayTrack, "rowKey">[], next: boolean) =>
    perform({ action: "add", tracks: tracks.map((track) => ({ ...track, rowKey: "" })), next });

  return Object.freeze({
    state,
    ready,
    dispose: () => {
      disposed = true;
      sidecarRequest += 1;
      unlisten?.();
      unlistenMetadata?.();
    },
    refreshPlaybackStatus,
    playTracks: (
      tracks: readonly PlaybackDisplayTrack[],
      startRowKey: string | null,
      allowSkipped = true,
    ) => perform({ action: "playTracks", tracks, startRowKey, allowSkipped }),
    playQueueItem: (rowKey: string) => perform({ action: "playItem", rowKey }),
    playPreviousTrack: () => perform({ action: "previous" }),
    playNextTrack: () => perform({ action: "next" }),
    togglePlayback: () => perform({ action: "toggle" }),
    setVolume: (volume: number) => perform({ action: "volume", volume }, false),
    toggleMute: () => perform({ action: "mute" }, false),
    beginSeeking,
    seekTo,
    withMetadataEditing,
    updateTrackMetadata: async (tracks: readonly TrackMetadataUpdate[]) => {
      const delta = await invokeCommand<PlaybackMetadataDelta | null>("playback_session_metadata", {
        tracks: tracks.map(({ id, title, artist, album, durationMs }) => ({
          id,
          title,
          artist,
          album,
          durationMs,
        })),
      });
      if (delta) await receiveMetadata(delta);
    },
    removeQueueItems: (rowKeys: readonly string[]) => remove({ action: "remove", rowKeys }),
    removeTrackFromQueue: (trackId: number) => remove({ action: "removeTrack", trackId }),
    clearQueue: () => remove({ action: "clear" }),
    addToNext: (track: Omit<PlaybackDisplayTrack, "rowKey">) => add([track], true),
    addTracksToNext: (tracks: readonly Omit<PlaybackDisplayTrack, "rowKey">[]) => add(tracks, true),
    addToQueueEnd: (track: Omit<PlaybackDisplayTrack, "rowKey">) => add([track], false),
    addTracksToQueueEnd: (tracks: readonly Omit<PlaybackDisplayTrack, "rowKey">[]) =>
      add(tracks, false),
    setRepeatOneEnabled: (enabled: boolean) => perform({ action: "repeat", enabled }),
    setShuffleEnabled: (enabled: boolean) => perform({ action: "shuffle", enabled }),
    loadTrackSkipPreferences: async () => {
      await request({ action: "snapshot" }, false);
    },
    setTracksSkipped: async (trackIds: readonly number[], skipped: boolean) => {
      if (isTrackSkipPending.value || trackIds.length === 0) return false;
      isTrackSkipPending.value = true;
      try {
        await invokeCommand<void>("set_tracks_skipped", {
          trackIds: [...new Set(trackIds)],
          skipped,
        });
        await request({ action: "snapshot" }, false);
        return true;
      } finally {
        isTrackSkipPending.value = false;
      }
    },
  });
}

let sharedPlaybackSession: ReturnType<typeof createPlaybackSession> | null = null;
export function usePlaybackSession() {
  sharedPlaybackSession ??= createPlaybackSession();
  return sharedPlaybackSession;
}
