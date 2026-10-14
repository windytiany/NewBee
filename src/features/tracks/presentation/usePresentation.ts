import { invoke } from "@tauri-apps/api/core";
import { onScopeDispose, readonly, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import type { TrackPresentation } from "@/features/tracks/types";
import { TRACKS_CHANGED_EVENT, type TracksChange } from "@/features/tracks/events";
import { logger } from "@/shared/logging/logger";

type PresentationInvoker = (
  command: "get_track_presentation",
  args: { trackId: number },
) => Promise<TrackPresentation | null>;

type PresentationState =
  { status: "loading" } | { status: "failed" } | { status: "ready"; track: TrackPresentation };

export function usePresentation(
  trackId: MaybeRefOrGetter<number | null>,
  invokeCommand: PresentationInvoker = invoke,
) {
  const presentation = ref<PresentationState>({ status: "loading" });
  let generation = 0;

  async function load(id: number) {
    const currentGeneration = ++generation;
    try {
      const result = await invokeCommand("get_track_presentation", { trackId: id });
      if (currentGeneration === generation)
        presentation.value = result ? { status: "ready", track: result } : { status: "loading" };
    } catch (error) {
      if (currentGeneration !== generation) return;
      presentation.value = { status: "failed" };
      logger.warn("tracks", "presentation_read_failed", error, { trackId: id });
    }
  }

  const stop = watch(
    () => toValue(trackId),
    (id) => {
      ++generation;
      presentation.value = { status: id === null ? "failed" : "loading" };
      if (id !== null) void load(id);
    },
    { immediate: true, flush: "sync" },
  );
  function onTracksChanged(event: Event) {
    const id = toValue(trackId);
    const { trackIds } = (event as CustomEvent<TracksChange>).detail;
    if (id !== null && (!trackIds || trackIds.includes(id))) void load(id);
  }
  globalThis.window?.addEventListener(TRACKS_CHANGED_EVENT, onTracksChanged);
  onScopeDispose(() => {
    ++generation;
    stop();
    globalThis.window?.removeEventListener(TRACKS_CHANGED_EVENT, onTracksChanged);
  });
  return readonly(presentation);
}
