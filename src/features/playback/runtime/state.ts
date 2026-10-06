import { logger } from "@/shared/logging/logger";
import { invoke } from "@tauri-apps/api/core";
import { readonly, ref, watch } from "vue";

import type {
  NowPlayingTrack,
  PlaybackTransition,
  PlaybackStartFailure,
  PlaybackCommandInvoker,
} from "@/features/playback/types";

const CURRENT_TRACK_STORAGE_KEY = "newbee.current-track";

function loadCurrentTrack(): NowPlayingTrack | null {
  try {
    const serializedTrack = globalThis.localStorage.getItem(CURRENT_TRACK_STORAGE_KEY);
    if (serializedTrack === null) return null;

    const parsedTrack: unknown = JSON.parse(serializedTrack);
    if (typeof parsedTrack !== "object" || parsedTrack === null || Array.isArray(parsedTrack)) {
      logger.warn(
        "features/playback/runtime/state",
        "Saved current track has an invalid format; ignoring it.",
      );
      return null;
    }

    const storedTrack = parsedTrack as Record<string, unknown>;
    if (
      typeof storedTrack.trackId !== "number" ||
      !Number.isSafeInteger(storedTrack.trackId) ||
      (storedTrack.title !== null && typeof storedTrack.title !== "string") ||
      (storedTrack.artist !== null && typeof storedTrack.artist !== "string")
    ) {
      logger.warn(
        "features/playback/runtime/state",
        "Saved current track is invalid; ignoring it.",
      );
      return null;
    }

    return {
      trackId: storedTrack.trackId,
      title: storedTrack.title,
      artist: storedTrack.artist,
      playbackId: null,
    };
  } catch (error) {
    logger.warn(
      "features/playback/runtime/state",
      "Could not read saved current track; using no current track.",
      error,
    );
    return null;
  }
}

function saveCurrentTrack(track: NowPlayingTrack) {
  try {
    globalThis.localStorage.setItem(
      CURRENT_TRACK_STORAGE_KEY,
      JSON.stringify({ trackId: track.trackId, title: track.title, artist: track.artist }),
    );
  } catch (error) {
    logger.warn("features/playback/runtime/state", "Could not save current track.", error);
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

export function createPlaybackState(invokeCommand: PlaybackCommandInvoker = invoke) {
  const currentTrack = ref<NowPlayingTrack | null>(loadCurrentTrack());
  const isPlaybackCommandPending = ref(false);
  const playbackStartError = ref("");
  const playbackStartFailure = ref<PlaybackStartFailure | null>(null);
  let playbackCommandGeneration = 0;
  let pendingPlaybackCommandGeneration: number | null = null;

  function waitForPlaybackCommand() {
    if (!isPlaybackCommandPending.value) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const stopWatching = watch(
        isPlaybackCommandPending,
        (isPending) => {
          if (isPending) return;
          stopWatching();
          resolve();
        },
        { flush: "sync" },
      );
    });
  }

  async function stopPlaybackInstance(playbackId: number) {
    await invokeCommand<boolean>("stop_playback", { playbackId });
  }

  function clearCurrentTrack(playbackId: number) {
    if (currentTrack.value?.playbackId !== playbackId) return false;
    return resetCurrentTrack();
  }

  function resetCurrentTrack() {
    if (currentTrack.value === null) return false;

    currentTrack.value = null;
    try {
      globalThis.localStorage.removeItem(CURRENT_TRACK_STORAGE_KEY);
    } catch (error) {
      logger.warn(
        "features/playback/runtime/state",
        "Could not clear the saved current track.",
        error,
      );
    }
    return true;
  }

  async function stopStalePlayback(playbackId: number) {
    clearCurrentTrack(playbackId);
    await stopPlaybackInstance(playbackId);
  }

  async function stopPlayback(playbackId: number) {
    playbackCommandGeneration += 1;
    clearCurrentTrack(playbackId);

    await stopPlaybackInstance(playbackId);
    while (isPlaybackCommandPending.value) await waitForPlaybackCommand();

    const hasNewerPendingCommand =
      pendingPlaybackCommandGeneration !== null &&
      pendingPlaybackCommandGeneration === playbackCommandGeneration;
    const hasNewerCurrentTrack =
      currentTrack.value !== null && currentTrack.value.playbackId !== playbackId;
    return !hasNewerPendingCommand && !hasNewerCurrentTrack;
  }

  async function releasePlaybackForEditing(trackIds: readonly number[]) {
    const track = currentTrack.value;
    if (!track || track.playbackId === null || !trackIds.includes(track.trackId)) return;
    const stopped = await invokeCommand<boolean>("stop_playback", { playbackId: track.playbackId });
    if (!stopped || currentTrack.value?.playbackId !== track.playbackId) {
      throw new Error("未能确认播放文件已释放，请重试。");
    }
    playbackCommandGeneration += 1;
    currentTrack.value = { ...track, playbackId: null };
    saveCurrentTrack(currentTrack.value);
  }

  function updateTrackMetadata(track: { id: number; title: string | null; artist: string | null }) {
    const current = currentTrack.value;
    if (current?.trackId !== track.id) return;
    currentTrack.value = { ...current, title: track.title, artist: track.artist };
    saveCurrentTrack(currentTrack.value);
  }

  async function finishPlayback(playbackId: number, canFinish: () => boolean) {
    const canReset = () => canFinish() && currentTrack.value?.playbackId === playbackId;
    if (isPlaybackCommandPending.value || !canReset()) return;
    isPlaybackCommandPending.value = true;
    try {
      await invokeCommand<void>("pause");
      if (!canReset()) return;
      await invokeCommand<void>("seek_to", { positionMs: 0 });
    } finally {
      isPlaybackCommandPending.value = false;
    }
  }

  function adoptTransition(track: PlaybackTransition) {
    if (currentTrack.value?.playbackId !== track.previousPlaybackId) return false;
    currentTrack.value = track;
    saveCurrentTrack(track);
    return true;
  }

  async function startTrack(
    trackId: number,
    canStart: () => boolean,
    rowKey?: string,
  ): Promise<boolean> {
    if (isPlaybackCommandPending.value || !canStart()) return false;

    logger.info("playback", "start_requested", { trackId });
    const commandGeneration = playbackCommandGeneration;
    pendingPlaybackCommandGeneration = commandGeneration;
    isPlaybackCommandPending.value = true;
    playbackStartError.value = "";
    playbackStartFailure.value = null;
    try {
      const args: { trackId: number; rowKey?: string } = { trackId };
      if (rowKey !== undefined) args.rowKey = rowKey;
      const track = await invokeCommand<NowPlayingTrack>("play_track", args);
      if (
        track.trackId !== trackId ||
        track.playbackId === null ||
        !Number.isSafeInteger(track.playbackId) ||
        track.playbackId <= 0
      ) {
        throw new Error("The returned track or playback instance does not match the request.");
      }

      if (commandGeneration !== playbackCommandGeneration || !canStart()) {
        try {
          await stopPlaybackInstance(track.playbackId);
        } catch (error) {
          playbackStartError.value = `Could not stop cancelled playback: ${errorMessage(error)}`;
        }
        return false;
      }

      logger.info("playback", "started", { trackId, playbackId: track.playbackId });
      currentTrack.value = track;
      saveCurrentTrack(track);
      return true;
    } catch (error) {
      logger.error("playback", "start_failed", error, { trackId });
      const message = errorMessage(error);
      const missingFilePrefix = "AUDIO_FILE_NOT_FOUND:";
      playbackStartFailure.value = message.startsWith(missingFilePrefix)
        ? { kind: "audio-file-not-found", message: message.slice(missingFilePrefix.length).trim() }
        : { kind: "playback-failed", message };
      const label =
        playbackStartFailure.value.kind === "audio-file-not-found"
          ? "Audio file not found"
          : "Playback failed";
      playbackStartError.value = `${label}: ${playbackStartFailure.value.message}`;
      return false;
    } finally {
      if (pendingPlaybackCommandGeneration === commandGeneration) {
        pendingPlaybackCommandGeneration = null;
      }
      isPlaybackCommandPending.value = false;
    }
  }

  function consumePlaybackStartFailure(): PlaybackStartFailure | null {
    const failure = playbackStartFailure.value;
    playbackStartError.value = "";
    playbackStartFailure.value = null;
    return failure;
  }

  return {
    currentTrack: readonly(currentTrack),
    isCommandPending: readonly(isPlaybackCommandPending),
    playbackStartError: readonly(playbackStartError),
    startTrack,
    adoptTransition,
    stopPlayback,
    stopStalePlayback,
    resetCurrentTrack,
    releasePlaybackForEditing,
    updateTrackMetadata,
    finishPlayback,
    consumePlaybackStartFailure,
  };
}
