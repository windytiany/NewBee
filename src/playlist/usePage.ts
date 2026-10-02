import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Ref } from "vue";
import { LIBRARY_CHANGED_EVENT } from "@/library/changes";
import { usePlaylistState } from "@/playlist/usePlaylistState";
import type { PlaylistAvailability } from "@/playlist/usePlaylistState";

/** Adapts page lifecycle and external invalidation to the playlist state module. */
export function usePlaylistPage(active: Readonly<Ref<boolean>>) {
  const availability = ref<PlaylistAvailability>("unavailable");
  const page = usePlaylistState(availability);

  function onLibraryChanged() {
    void page.refreshPlaylists(undefined, true);
  }

  watch(
    active,
    (isActive) => {
      if (availability.value === "unavailable") return;
      availability.value = isActive ? "active" : "background";
    },
    { flush: "sync" },
  );

  onMounted(() => {
    globalThis.window.addEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
    availability.value = active.value ? "active" : "background";
  });

  onBeforeUnmount(() => {
    availability.value = "unavailable";
    globalThis.window.removeEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
  });

  return page;
}
