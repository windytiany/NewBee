import { ref, watch } from "vue";

export type PlaybackDisplayMode = "track" | "lyrics" | "both";

const STORAGE_KEY = "newbee.playing-presentation";
const DEFAULT_PRESENTATION: PlaybackDisplayMode = "track";

function loadPresentation(): PlaybackDisplayMode {
  try {
    const storedPresentation = globalThis.localStorage.getItem(STORAGE_KEY);
    if (
      storedPresentation === "track" ||
      storedPresentation === "lyrics" ||
      storedPresentation === "both"
    ) {
      return storedPresentation;
    }
    return DEFAULT_PRESENTATION;
  } catch (error) {
    globalThis.console.error("Could not read the saved playing presentation; using track.", error);
    return DEFAULT_PRESENTATION;
  }
}

function savePresentation(presentation: PlaybackDisplayMode) {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, presentation);
  } catch (error) {
    globalThis.console.error("Could not save the playing presentation.", error);
  }
}

export function useDisplayMode() {
  const presentation = ref<PlaybackDisplayMode>(loadPresentation());
  watch(presentation, savePresentation, { flush: "sync", immediate: true });

  return { presentation };
}
