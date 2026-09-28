import { invoke } from "@tauri-apps/api/core";
import { onMounted, ref, watch } from "vue";

const DEFAULT_VOLUME = 50;
const VOLUME_STORAGE_KEY = "newbee.playback-volume";

type PlaybackVolumeState = {
  volume: number;
  lastNonMutedVolume: number;
};

const DEFAULT_PLAYBACK_VOLUME = {
  volume: DEFAULT_VOLUME,
  lastNonMutedVolume: DEFAULT_VOLUME,
} satisfies PlaybackVolumeState;

function isVolumeLevel(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

function loadPlaybackVolume(): PlaybackVolumeState {
  try {
    const serializedVolume = globalThis.localStorage.getItem(VOLUME_STORAGE_KEY);
    if (serializedVolume === null) return { ...DEFAULT_PLAYBACK_VOLUME };

    const parsedVolume: unknown = JSON.parse(serializedVolume);
    if (typeof parsedVolume !== "object" || parsedVolume === null || Array.isArray(parsedVolume)) {
      globalThis.console.error("Saved playback volume has an invalid format; using the default.");
      return { ...DEFAULT_PLAYBACK_VOLUME };
    }

    const storedVolume = parsedVolume as Record<string, unknown>;
    if (
      !isVolumeLevel(storedVolume.volume) ||
      !isVolumeLevel(storedVolume.lastNonMutedVolume) ||
      storedVolume.lastNonMutedVolume === 0
    ) {
      globalThis.console.error("Saved playback volume is invalid; using the default.");
      return { ...DEFAULT_PLAYBACK_VOLUME };
    }

    return {
      volume: storedVolume.volume,
      lastNonMutedVolume:
        storedVolume.volume > 0 ? storedVolume.volume : storedVolume.lastNonMutedVolume,
    };
  } catch (error) {
    globalThis.console.error("Could not read saved playback volume; using the default.", error);
    return { ...DEFAULT_PLAYBACK_VOLUME };
  }
}

function savePlaybackVolume(volume: number, lastNonMutedVolume: number) {
  try {
    globalThis.localStorage.setItem(
      VOLUME_STORAGE_KEY,
      JSON.stringify({ volume, lastNonMutedVolume }),
    );
  } catch (error) {
    globalThis.console.error("Could not save playback volume.", error);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

export function usePlaybackVolume() {
  const initialVolume = loadPlaybackVolume();
  const volume = ref(initialVolume.volume);
  const lastNonMutedVolume = ref(initialVolume.lastNonMutedVolume);
  const volumeError = ref("");
  const isVolumeSyncReady = ref(false);
  let queuedVolume: number | null = null;
  let inFlightVolume: number | null = null;
  let synchronizedVolume: number | null = null;
  let volumeSyncWorker: Promise<void> | null = null;

  async function flushVolumeSyncQueue(): Promise<void> {
    while (queuedVolume !== null) {
      const requestedVolume = queuedVolume;
      queuedVolume = null;
      inFlightVolume = requestedVolume;

      try {
        await invoke("set_volume", { volume: requestedVolume });
        synchronizedVolume = requestedVolume;
        if (queuedVolume === null && volume.value === requestedVolume) {
          isVolumeSyncReady.value = true;
          volumeError.value = "";
        }
      } catch (error) {
        synchronizedVolume = null;
        isVolumeSyncReady.value = false;
        volumeError.value = `Volume update failed: ${errorMessage(error)}`;
      } finally {
        inFlightVolume = null;
      }
    }
  }

  function synchronizeVolume(nextVolume: number): Promise<void> {
    if (
      volumeSyncWorker === null &&
      queuedVolume === null &&
      isVolumeSyncReady.value &&
      synchronizedVolume === nextVolume
    ) {
      return Promise.resolve();
    }
    if (volumeSyncWorker !== null && queuedVolume === null && inFlightVolume === nextVolume) {
      return volumeSyncWorker;
    }

    queuedVolume = nextVolume;
    isVolumeSyncReady.value = false;
    if (volumeSyncWorker !== null) return volumeSyncWorker;

    const worker = flushVolumeSyncQueue();
    volumeSyncWorker = worker;
    void worker.finally(() => {
      if (volumeSyncWorker === worker) volumeSyncWorker = null;
      if (queuedVolume !== null) void synchronizeVolume(queuedVolume);
    });
    return worker;
  }

  async function ensureCurrentVolumeIsSynchronized(): Promise<boolean> {
    while (true) {
      await synchronizeVolume(volume.value);
      if (
        isVolumeSyncReady.value &&
        synchronizedVolume === volume.value &&
        queuedVolume === null &&
        volumeSyncWorker === null
      ) {
        return true;
      }
      if (queuedVolume === null && volumeSyncWorker === null) return false;
    }
  }

  function toggleMute() {
    if (volume.value > 0) {
      lastNonMutedVolume.value = volume.value;
      volume.value = 0;
      return;
    }

    volume.value = lastNonMutedVolume.value;
  }

  watch(
    volume,
    (nextVolume) => {
      if (nextVolume > 0) lastNonMutedVolume.value = nextVolume;
      savePlaybackVolume(nextVolume, lastNonMutedVolume.value);
      void synchronizeVolume(nextVolume);
    },
    { flush: "sync" },
  );

  onMounted(() => {
    void synchronizeVolume(volume.value);
  });

  return {
    volume,
    volumeError,
    toggleMute,
    ensureCurrentVolumeIsSynchronized,
  };
}
