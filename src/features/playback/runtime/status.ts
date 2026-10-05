import { computed, readonly, ref, watch } from "vue";
import type { ComputedRef, Ref } from "vue";
import type {
  NowPlayingTrack,
  PlaybackCommandInvoker,
  PlaybackTransition,
  PlaybackStatus,
} from "@/features/playback/types";

export type InternalPlaybackStatus = PlaybackStatus & {
  playbackId: number | null;
  nowPlaying?: PlaybackTransition | null;
};

type PlaybackStatusObserverOptions = {
  invokeCommand: PlaybackCommandInvoker;
  currentTrack: Readonly<Ref<NowPlayingTrack | null>>;
  isCommandPending: Readonly<ComputedRef<boolean>>;
  isSeeking: Readonly<Ref<boolean>>;
  activeQueueRowKey: Readonly<ComputedRef<string | null>>;
  playbackError: Ref<string>;
  observePlaybackTransition: (track: PlaybackTransition) => boolean;
  observePlaybackState: (
    playbackId: number,
    isPlaying: boolean,
    hasReachedEnd: boolean,
  ) => Promise<boolean>;
};

const EMPTY_PLAYBACK_STATUS: InternalPlaybackStatus = {
  hasAudio: false,
  isPlaying: false,
  hasEnded: false,
  playbackId: null,
  positionMs: 0,
  durationMs: 0,
};

export function createPlaybackStatusObserver(options: PlaybackStatusObserverOptions) {
  const internalStatus = ref<InternalPlaybackStatus>({ ...EMPTY_PLAYBACK_STATUS });
  const publicStatus = computed<PlaybackStatus>(() => {
    const status = internalStatus.value;
    return {
      hasAudio: status.hasAudio,
      isPlaying: status.isPlaying,
      hasEnded: status.hasEnded,
      positionMs: status.positionMs,
      durationMs: status.durationMs,
    };
  });
  let statusRequestsInFlight = 0;
  let statusRequestVersion = 0;
  const isStatusUpdatePending = ref(false);

  function isStatusForCurrentTrack(status: InternalPlaybackStatus) {
    const track = options.currentTrack.value;
    if (status.hasAudio) {
      return track !== null && track.playbackId !== null && status.playbackId === track.playbackId;
    }
    return track === null || track.playbackId === null;
  }

  async function observePlaybackStatus(status: InternalPlaybackStatus) {
    const track = options.currentTrack.value;
    if (
      options.isCommandPending.value ||
      options.isSeeking.value ||
      !status.hasAudio ||
      status.playbackId === null ||
      status.playbackId !== track?.playbackId ||
      options.activeQueueRowKey.value === null
    ) {
      return;
    }

    await options.observePlaybackState(status.playbackId, status.isPlaying, status.hasEnded);
  }

  async function queryPlaybackStatus(force: boolean): Promise<boolean> {
    if (statusRequestsInFlight > 0 && !force) return false;

    statusRequestsInFlight += 1;
    const requestVersion = ++statusRequestVersion;
    isStatusUpdatePending.value = true;
    try {
      const status = await options.invokeCommand<InternalPlaybackStatus>("playback_status");
      if (requestVersion !== statusRequestVersion) return false;
      if (status.nowPlaying) options.observePlaybackTransition(status.nowPlaying);
      if (!isStatusForCurrentTrack(status)) return false;

      internalStatus.value = status;
      await observePlaybackStatus(status);
      if (options.playbackError.value.startsWith("Playback status unavailable:")) {
        options.playbackError.value = "";
      }
      return true;
    } catch (error) {
      if (requestVersion === statusRequestVersion) {
        const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
        options.playbackError.value = `Playback status unavailable: ${message}`;
      }
      return false;
    } finally {
      statusRequestsInFlight -= 1;
      if (requestVersion === statusRequestVersion) isStatusUpdatePending.value = false;
    }
  }

  watch(
    options.currentTrack,
    (track) => {
      statusRequestVersion += 1;
      if (track === null) {
        isStatusUpdatePending.value = false;
        internalStatus.value = { ...EMPTY_PLAYBACK_STATUS };
        return;
      }
      void queryPlaybackStatus(true);
    },
    { flush: "sync" },
  );

  return Object.freeze({
    internalStatus: readonly(internalStatus),
    status: readonly(publicStatus),
    isSettled: computed(
      () => !isStatusUpdatePending.value && isStatusForCurrentTrack(internalStatus.value),
    ),
    refresh: () => queryPlaybackStatus(false),
    refreshAfterCommand: () => queryPlaybackStatus(true),
    invalidate: () => {
      statusRequestVersion += 1;
      isStatusUpdatePending.value = false;
    },
  });
}
