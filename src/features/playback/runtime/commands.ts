import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import type { ComputedRef, Ref } from "vue";
import { PlaybackQueueCoordinator } from "@/features/playback/queue/coordinator";
import type { InternalPlaybackStatus } from "@/features/playback/runtime/status";
import { createPlaybackState } from "@/features/playback/runtime/state";
import type {
  NowPlayingTrack,
  PlaybackCommandInvoker,
  PlaybackDisplayTrack,
} from "@/features/playback/types";

type PlaybackSessionCommandOptions = {
  invokeCommand: PlaybackCommandInvoker;
  playbackState: ReturnType<typeof createPlaybackState>;
  coordinator: PlaybackQueueCoordinator;
  currentTrack: Readonly<Ref<NowPlayingTrack | null>>;
  currentStatus: Readonly<Ref<InternalPlaybackStatus>>;
  displayedTracks: Readonly<Ref<readonly PlaybackDisplayTrack[]>>;
  currentRowKey: Readonly<Ref<string | null>>;
  canStartRestoredQueue: Readonly<ComputedRef<boolean>>;
  restoredStartRowKey: string | null;
  isTrackSkipped: (trackId: number) => boolean;
  loadTrackPreferences: () => Promise<boolean>;
  playbackError: Ref<string>;
  isCommandPending: Readonly<ComputedRef<boolean>>;
  isSessionCommandPending: Ref<boolean>;
  isSeeking: Ref<boolean>;
  refreshStatus: () => Promise<boolean>;
  invalidateStatus: () => void;
};

export function createPlaybackSessionCommands(options: PlaybackSessionCommandOptions) {
  let userIntentGeneration = 0;
  let seekingIntentGeneration: number | null = null;
  let sessionCommandOwner: number | null = null;

  function beginUserIntent() {
    userIntentGeneration += 1;
    options.invalidateStatus();
    if (options.isSeeking.value) {
      options.isSeeking.value = false;
      seekingIntentGeneration = null;
    }
    return userIntentGeneration;
  }

  function isCurrentUserIntent(generation: number) {
    return generation === userIntentGeneration;
  }

  function setSessionCommandPending(generation: number, isPending: boolean) {
    if (isPending) {
      sessionCommandOwner = generation;
      options.isSessionCommandPending.value = true;
    } else if (sessionCommandOwner === generation) {
      sessionCommandOwner = null;
      options.isSessionCommandPending.value = false;
    }
  }

  function startCurrentTrack(trackId: number, generation: number): Promise<boolean> {
    const track = options.currentTrack.value;
    if (track === null) return Promise.resolve(false);

    const rowKey = options.currentRowKey.value;
    const queueItem = options.displayedTracks.value.find((item) => item.rowKey === rowKey);
    if (rowKey !== null && queueItem?.trackId === track.trackId) {
      return options.coordinator.playQueueItem(rowKey, false);
    }

    if (options.isTrackSkipped(trackId)) return Promise.resolve(false);
    return options.playbackState.startTrack(trackId, () => {
      const current = options.currentTrack.value;
      return (
        isCurrentUserIntent(generation) &&
        !options.isTrackSkipped(trackId) &&
        current?.trackId === track.trackId &&
        current.playbackId === track.playbackId
      );
    });
  }

  function playTracks(
    items: readonly PlaybackDisplayTrack[],
    startRowKey: string,
    allowSkipped = true,
  ) {
    beginUserIntent();
    return options.coordinator.replaceAndPlay(items, startRowKey, allowSkipped);
  }

  function playQueueItem(rowKey: string) {
    beginUserIntent();
    return options.coordinator.playQueueItem(rowKey);
  }

  function playPreviousTrack() {
    beginUserIntent();
    return options.coordinator.playPrevious();
  }

  function playNextTrack() {
    beginUserIntent();
    return options.coordinator.playNext();
  }

  async function togglePlayback(ensureVolumeIsSynchronized: () => Promise<boolean>) {
    if (options.isCommandPending.value || options.isSeeking.value) return false;

    const generation = beginUserIntent();
    setSessionCommandPending(generation, true);
    options.coordinator.invalidatePendingAdvance();

    try {
      if (!(await options.refreshStatus()) || !isCurrentUserIntent(generation)) return false;

      const status = options.currentStatus.value;
      if (
        !status.hasAudio ||
        (!status.isPlaying && status.durationMs > 0 && status.positionMs >= status.durationMs)
      ) {
        if (!(await options.loadTrackPreferences()) || !isCurrentUserIntent(generation))
          return false;
        const track = options.currentTrack.value;
        const shouldStartRestoredQueue =
          options.canStartRestoredQueue.value && (track === null || track.playbackId === null);
        if ((!track && !shouldStartRestoredQueue) || !(await ensureVolumeIsSynchronized())) {
          return false;
        }
        if (!isCurrentUserIntent(generation)) return false;

        setSessionCommandPending(generation, false);
        let started = false;
        if (shouldStartRestoredQueue && options.restoredStartRowKey !== null) {
          started = await options.coordinator.playQueueItem(options.restoredStartRowKey, false);
        } else if (track !== null) {
          started = await startCurrentTrack(track.trackId, generation);
        }
        if (!isCurrentUserIntent(generation)) return false;
        setSessionCommandPending(generation, true);
        if (!started) {
          await options.refreshStatus();
          return false;
        }
      } else if (status.isPlaying) {
        await options.invokeCommand<void>("pause");
        logger.info("playback", "paused");
        options.coordinator.suppressPlaybackEnd(
          options.currentTrack.value?.playbackId ?? status.playbackId,
        );
      } else {
        await options.invokeCommand<void>("resume");
        logger.info("playback", "resumed");
        options.coordinator.allowPlaybackEnd(
          options.currentTrack.value?.playbackId ?? status.playbackId,
        );
      }

      if (!isCurrentUserIntent(generation)) return false;
      options.playbackError.value = "";
      options.playbackState.consumePlaybackStartFailure();
      setSessionCommandPending(generation, false);
      await options.refreshStatus();
      return true;
    } catch (error) {
      if (isCurrentUserIntent(generation)) {
        logger.error("playback", "command_failed", error);
        const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
        options.playbackError.value = `Playback command failed: ${message}`;
        setSessionCommandPending(generation, false);
        await options.refreshStatus();
      }
      return false;
    } finally {
      setSessionCommandPending(generation, false);
    }
  }

  function beginSeeking() {
    if (options.isSeeking.value) return;
    seekingIntentGeneration = beginUserIntent();
    options.isSeeking.value = true;
    options.coordinator.invalidatePendingAdvance();
  }

  async function seekTo(positionMs: number) {
    const generation = seekingIntentGeneration;
    if (
      !options.isSeeking.value ||
      generation === null ||
      !isCurrentUserIntent(generation) ||
      options.isCommandPending.value
    ) {
      return false;
    }

    setSessionCommandPending(generation, true);
    try {
      await options.invokeCommand<void>("seek_to", { positionMs });
      logger.debug("playback", "seek_completed");
      options.playbackError.value = "";
      options.playbackState.consumePlaybackStartFailure();
      return true;
    } catch (error) {
      logger.error("playback", "seek_failed", error);
      const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
      options.playbackError.value = `Seek failed: ${message}`;
      return false;
    } finally {
      options.isSeeking.value = false;
      if (seekingIntentGeneration === generation) seekingIntentGeneration = null;
      setSessionCommandPending(generation, false);
      if (isCurrentUserIntent(generation)) await options.refreshStatus();
    }
  }

  async function withMetadataEditing<T>(
    trackIds: readonly number[],
    save: () => Promise<T>,
  ): Promise<T> {
    if (options.isCommandPending.value) throw new Error(t("播放操作尚未完成，请稍后重试。"));
    const generation = beginUserIntent();
    setSessionCommandPending(generation, true);
    options.coordinator.invalidatePendingAdvance();
    try {
      await options.playbackState.releasePlaybackForEditing(trackIds);
      if (options.currentTrack.value?.playbackId === null) options.coordinator.detachPlayback();
      return await save();
    } finally {
      setSessionCommandPending(generation, false);
      await options.refreshStatus();
    }
  }

  return Object.freeze({
    withMetadataEditing,
    playTracks,
    playQueueItem,
    playPreviousTrack,
    playNextTrack,
    togglePlayback,
    beginSeeking,
    seekTo,
  });
}
