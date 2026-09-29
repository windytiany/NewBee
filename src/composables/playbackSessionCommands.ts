import type { ComputedRef, Ref } from "vue";
import { PlaybackQueueCoordinator } from "@/composables/playbackQueueCoordinator";
import type { InternalPlaybackStatus } from "@/composables/playbackStatusObserver";
import {
  createPlaybackState,
  type NowPlayingTrack,
  type PlaybackCommandInvoker,
} from "@/composables/usePlaybackState";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";

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

  async function startCurrentTrack(trackId: number, generation: number) {
    const track = options.currentTrack.value;
    if (track === null) return false;

    const rowKey = options.currentRowKey.value;
    const queueItem = options.displayedTracks.value.find((item) => item.rowKey === rowKey);
    if (rowKey !== null && queueItem?.trackId === track.trackId) {
      return options.coordinator.playQueueItem(rowKey);
    }

    return options.playbackState.startTrack(trackId, () => {
      const current = options.currentTrack.value;
      return (
        isCurrentUserIntent(generation) &&
        current?.trackId === track.trackId &&
        current.playbackId === track.playbackId
      );
    });
  }

  function playTracks(items: readonly PlaybackDisplayTrack[], startRowKey: string) {
    beginUserIntent();
    return options.coordinator.replaceAndPlay(items, startRowKey);
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
          started = await options.coordinator.playQueueItem(options.restoredStartRowKey);
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
        options.coordinator.suppressPlaybackEnd(
          options.currentTrack.value?.playbackId ?? status.playbackId,
        );
      } else {
        await options.invokeCommand<void>("resume");
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
      options.playbackError.value = "";
      options.playbackState.consumePlaybackStartFailure();
      return true;
    } catch (error) {
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

  return Object.freeze({
    playTracks,
    playQueueItem,
    playPreviousTrack,
    playNextTrack,
    togglePlayback,
    beginSeeking,
    seekTo,
  });
}
