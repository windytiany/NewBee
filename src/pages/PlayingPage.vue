<template>
  <section
    aria-label="Now playing"
    class="relative flex w-full flex-col items-center justify-center gap-8 py-8"
    :class="[
      presentation === 'lyrics' ? 'max-w-none px-0' : 'max-w-6xl px-6',
      presentation === 'both' ? 'md:flex-row md:gap-14' : '',
    ]"
  >
    <button
      :aria-label="nextModeLabel[presentation]"
      class="fixed right-4 top-16 z-40 grid size-10 place-items-center rounded-full bg-spotify-interactive text-spotify-muted shadow-lg transition-colors hover:bg-[#282828] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green sm:right-6"
      :title="nextModeLabel[presentation]"
      type="button"
      @click="cyclePresentation"
    >
      <component :is="nextModeIcon[presentation]" aria-hidden="true" class="size-5" />
    </button>

    <TrackDetail
      v-if="presentation !== 'lyrics'"
      :compact="presentation === 'both'"
      :horizontal="presentation === 'track'"
    />
    <Lyrics
      v-if="presentation !== 'track'"
      :class="presentation === 'both' ? 'md:min-w-0 md:max-w-none md:flex-1' : 'max-w-none'"
      :compact="presentation === 'both'"
    />
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Columns2, DiscAlbum, ListMusic } from "@lucide/vue";
import Lyrics from "../components/Lyrics.vue";
import TrackDetail from "../components/TrackDetail.vue";

type Presentation = "track" | "lyrics" | "both";

const presentation = ref<Presentation>("track");
const nextPresentation: Record<Presentation, Presentation> = {
  track: "lyrics",
  lyrics: "both",
  both: "track",
};
const nextModeLabel: Record<Presentation, string> = {
  track: "Show lyrics",
  lyrics: "Show track and lyrics",
  both: "Show track details",
};
const nextModeIcon = {
  track: ListMusic,
  lyrics: Columns2,
  both: DiscAlbum,
};

function cyclePresentation() {
  presentation.value = nextPresentation[presentation.value];
}
</script>
