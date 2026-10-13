import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { onMounted, onUnmounted } from "vue";
import { usePlaybackSession } from "@/features/playback/session";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import type { TrackReadResult } from "@/features/tracks/types";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";

type Subscribe = (receive: (results: readonly TrackReadResult[]) => void) => Promise<() => void>;

export function createTrackBridge(
  refresh: (ids: readonly number[]) => Promise<void>,
  subscribe: Subscribe,
  reportError: (error: unknown) => void,
) {
  const pending = new Set<number>();
  let disposed = false;
  let stop: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;

  function schedule() {
    if (disposed || flushing || timer !== null || !pending.size) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, 25);
  }

  async function flush() {
    if (disposed) return;
    flushing = true;
    const ids = [...pending];
    pending.clear();
    try {
      await refresh(ids);
    } catch (error) {
      if (!disposed) reportError(error);
    } finally {
      flushing = false;
      schedule();
    }
  }

  async function start() {
    try {
      const unlisten = await subscribe((results) => {
        if (disposed) return;
        for (const result of results) {
          if (result.databaseUpdated) pending.add(result.trackId);
        }
        const failure = results.find((result) => result.error);
        if (failure) reportError(failure.error);
        schedule();
      });
      if (disposed) unlisten();
      else stop = unlisten;
    } catch (error) {
      if (!disposed) reportError(error);
    }
  }

  function dispose() {
    disposed = true;
    stop?.();
    if (timer !== null) clearTimeout(timer);
    pending.clear();
  }

  return { start, dispose, isDisposed: () => disposed };
}

export function useTrackBridge() {
  if (!isTauri()) return;
  const session = usePlaybackSession();
  const synchronization = createTrackSynchronization(session, invoke);
  const bridge = createTrackBridge(
    (ids) => synchronization.refresh(ids, () => !bridge.isDisposed()),
    (receive) => listen<TrackReadResult[]>("tracks-confirmed", ({ payload }) => receive(payload)),
    (error) => {
      logger.warn("tracks/bridge", "Track confirmation failed.", error);
      notify({ type: "error", message: String(error), key: "track-confirmation" });
    },
  );
  onMounted(() => {
    void (async () => {
      await bridge.start();
      await session.ready;
      if (bridge.isDisposed()) return;
      const ids = session.state.displayedTracks.value.flatMap((track) =>
        track.trackId == null ? [] : [track.trackId],
      );
      try {
        await synchronization.refresh(ids, () => !bridge.isDisposed());
      } catch (error) {
        logger.warn("tracks/bridge", "Could not synchronize restored tracks.", error);
      }
    })();
  });
  onUnmounted(bridge.dispose);
}
