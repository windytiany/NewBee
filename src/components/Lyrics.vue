<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <section
    aria-label="Lyrics"
    class="lyrics-scroll-container max-h-[min(68vh,40rem)] w-full overflow-y-auto py-2"
  >
    <ol class="mx-auto max-w-5xl space-y-2" :class="{ 'px-6': !props.compact }">
      <li
        v-for="(lyric, index) in lyrics"
        :key="lyric"
        :aria-current="index === activeLyricIndex ? 'true' : undefined"
        class="leading-tight font-bold tracking-tight transition-colors"
        :class="[
          props.compact ? 'text-2xl md:text-3xl' : 'text-3xl sm:text-4xl md:text-5xl',
          index === activeLyricIndex ? 'text-white' : 'text-spotify-muted/45',
        ]"
      >
        {{ lyric }}
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ compact?: boolean }>(), {
  compact: false,
});

const activeLyricIndex = 8;
const lyrics = [
  "Somewhere in the afterglow",
  "We let the whole world fade away",
  "Every heartbeat finds the rhythm",
  "The city wakes beneath a silver sky",
  "I held my breath and counted every light",
  "You said the morning always comes around",
  "We crossed the empty streets without a sound",
  "And though the night kept pulling us apart",
  "Even when the streets are empty and every window has gone dark, I can still hear the echoes of everything we promised each other when the night was young.",
  "The radio was playing our old song",
  "Maybe we were chasing something neither of us could name, following the headlights until the whole horizon opened up before us.",
  "I can feel the summer fading in the air",
  "The windows glow like candles in the rain",
  "We kept on driving past the edge of town",
  "We followed the headlights until the highway disappeared into the mountains, then kept driving beneath the open sky because neither of us was ready to go home.",
  "The morning found us still awake",
  "You left your coat beside the door",
  "Still I remember every word you said",
  "Every little promise sounded like a place we could return to when the world became too loud and we needed somewhere quiet to begin again.",
  "The road was shining after all the rain",
  "When the last train disappeared beyond the station, we stayed a little longer just to see the city turn from blue to gold.",
  "Maybe the story isn't over yet",
  "We keep walking toward the light",
];
</script>

<style scoped>
.lyrics-scroll-container {
  scrollbar-width: none;
}

.lyrics-scroll-container::-webkit-scrollbar {
  display: none;
}
</style>
