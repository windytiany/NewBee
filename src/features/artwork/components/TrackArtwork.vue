<template>
  <div
    class="relative overflow-hidden"
    :class="{ 'shadow-md': !props.pending && status !== 'loading' }"
  >
    <img
      v-if="!props.pending && status === 'ready' && url"
      :alt="props.alt"
      class="h-full w-full object-cover"
      :src="url"
    />
    <slot v-else-if="!props.pending && status === 'fallback'" />
  </div>
</template>

<script setup lang="ts">
import { toRef } from "vue";
import { useTrackArtwork } from "@/features/artwork/useTrackArtwork";

const props = withDefaults(
  defineProps<{
    trackId: number | null;
    pending?: boolean;
    alt?: string;
  }>(),
  {
    pending: false,
    alt: "",
  },
);

const { status, url } = useTrackArtwork(toRef(props, "trackId"));
</script>
