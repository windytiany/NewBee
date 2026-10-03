import { invoke, isTauri } from "@tauri-apps/api/core";
import { onMounted, onScopeDispose, readonly, ref, shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";

export const SPECTRUM_BAND_COUNT = 8;
const POLL_INTERVAL_MS = 50;
const DECAY_PER_FRAME = 0.12;

function emptyBands() {
  return Array<number>(SPECTRUM_BAND_COUNT).fill(0);
}

export function usePlaybackSpectrum(
  playbackId: MaybeRefOrGetter<number | null>,
  active: MaybeRefOrGetter<boolean>,
) {
  const bands = shallowRef(emptyBands());
  const error = ref("");
  const mounted = ref(false);
  const visible = ref(true);
  let generation = 0;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let requestInFlight = false;

  function schedule(id: number, requestGeneration: number) {
    if (requestGeneration !== generation) return;
    timer = globalThis.setTimeout(() => {
      timer = null;
      void poll(id, requestGeneration);
    }, POLL_INTERVAL_MS);
  }

  async function poll(id: number, requestGeneration: number) {
    if (requestGeneration !== generation) return;
    if (requestInFlight) {
      schedule(id, requestGeneration);
      return;
    }
    requestInFlight = true;
    try {
      const values = await invoke<unknown>("playback_spectrum", { playbackId: id });
      if (requestGeneration !== generation) return;
      if (
        !Array.isArray(values) ||
        values.length !== SPECTRUM_BAND_COUNT ||
        !values.every(Number.isFinite)
      )
        throw new Error("无效的频谱数据");
      bands.value = values.map((value: number, index) =>
        Math.max(Math.min(1, Math.max(0, value)), (bands.value[index] ?? 0) - DECAY_PER_FRAME),
      );
      error.value = "";
    } catch (reason) {
      if (requestGeneration !== generation) return;
      bands.value = emptyBands();
      error.value = `实时频谱不可用：${reason instanceof Error ? reason.message : String(reason)}`;
    } finally {
      requestInFlight = false;
      schedule(id, requestGeneration);
    }
  }

  const stop = watch(
    () => (mounted.value && visible.value && toValue(active) ? toValue(playbackId) : null),
    (id) => {
      ++generation;
      if (timer !== null) globalThis.clearTimeout(timer);
      timer = null;
      bands.value = emptyBands();
      error.value = "";
      if (id !== null && isTauri()) void poll(id, generation);
    },
    { immediate: true, flush: "sync" },
  );

  function updateVisibility() {
    visible.value = !globalThis.document.hidden;
  }

  onMounted(() => {
    updateVisibility();
    globalThis.document.addEventListener("visibilitychange", updateVisibility);
    mounted.value = true;
  });
  onScopeDispose(() => {
    ++generation;
    stop();
    if (timer !== null) globalThis.clearTimeout(timer);
    globalThis.document.removeEventListener("visibilitychange", updateVisibility);
  });

  return { bands: readonly(bands), error: readonly(error) };
}
