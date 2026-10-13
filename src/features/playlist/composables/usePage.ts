import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Ref } from "vue";
import { TRACKS_CHANGED_EVENT, type TracksChange } from "@/features/tracks/events";
import { PLAYLIST_CHANGED_EVENT } from "@/features/playlist/events";
import { usePlaylistState } from "@/features/playlist/composables/useState";
import type { PlaylistAvailability } from "@/features/playlist/composables/useState";

/** Adapts page lifecycle and external invalidation to the playlist state module. */
export function usePlaylistPage(active: Readonly<Ref<boolean>>) {
  const availability = ref<PlaylistAvailability>("unavailable");
  const page = usePlaylistState(availability);

  function onTracksChanged(event: Event) {
    page.updateTrackMetadata((event as CustomEvent<TracksChange>).detail);
  }

  function onPlaylistChanged() {
    void page.refreshPlaylists();
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
    globalThis.window.addEventListener(TRACKS_CHANGED_EVENT, onTracksChanged);
    globalThis.window.addEventListener(PLAYLIST_CHANGED_EVENT, onPlaylistChanged);
    availability.value = active.value ? "active" : "background";
  });

  onBeforeUnmount(() => {
    availability.value = "unavailable";
    globalThis.window.removeEventListener(TRACKS_CHANGED_EVENT, onTracksChanged);
    globalThis.window.removeEventListener(PLAYLIST_CHANGED_EVENT, onPlaylistChanged);
  });

  return page;
}
