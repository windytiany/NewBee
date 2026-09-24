<template>
  <article
    aria-label="Track details"
    class="w-full"
    :class="
      props.horizontal
        ? 'grid max-w-5xl grid-cols-2 items-center gap-6 text-left sm:gap-10'
        : props.compact
          ? 'flex max-w-xs flex-col items-center gap-4 text-center'
          : 'flex max-w-sm flex-col items-center gap-6 text-center'
    "
  >
    <div
      aria-label="Album cover placeholder"
      class="grid aspect-square w-full place-items-center rounded-xl bg-linear-to-br from-spotify-interactive via-[#303030] to-spotify-surface shadow-2xl"
      :class="props.horizontal ? 'max-w-md justify-self-center' : ''"
      role="img"
    >
      <DiscAlbum
        aria-hidden="true"
        class="text-spotify-muted/80"
        :class="props.horizontal ? 'size-32 sm:size-40' : 'size-24'"
        stroke-width="1.25"
      />
    </div>

    <div
      class="flex flex-col"
      :class="props.horizontal ? 'items-start gap-3' : 'items-center gap-1'"
    >
      <h1
        class="font-bold tracking-tight"
        :class="
          props.horizontal
            ? 'text-4xl sm:text-5xl lg:text-6xl'
            : props.compact
              ? 'text-2xl'
              : 'text-3xl sm:text-4xl'
        "
      >
        Title
      </h1>
      <p
        class="text-spotify-muted"
        :class="props.horizontal ? 'text-xl sm:text-2xl' : props.compact ? 'text-sm' : 'text-base'"
      >
        Artist
      </p>
      <p
        :class="
          props.horizontal
            ? 'text-lg sm:text-xl text-spotify-muted/70'
            : 'text-sm text-spotify-muted/70'
        "
      >
        Album
      </p>
    </div>
  </article>
</template>

<script setup lang="ts">
import { DiscAlbum } from "@lucide/vue";

const props = withDefaults(defineProps<{ compact?: boolean; horizontal?: boolean }>(), {
  compact: false,
  horizontal: false,
});
</script>
