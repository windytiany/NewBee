import { ref, watch } from "vue";

export type PlayingPresentation = "track" | "lyrics" | "both";

const STORAGE_KEY = "newbee.playing-presentation";
const DEFAULT_PRESENTATION: PlayingPresentation = "track";

function loadPresentation(): PlayingPresentation {
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

function savePresentation(presentation: PlayingPresentation) {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, presentation);
  } catch (error) {
    globalThis.console.error("Could not save the playing presentation.", error);
  }
}

export function usePersistentPlayingPresentation() {
  const presentation = ref<PlayingPresentation>(loadPresentation());
  watch(presentation, savePresentation, { flush: "sync", immediate: true });

  return { presentation };
}
