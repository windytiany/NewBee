<template>
  <div
    ref="coverElement"
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
import { ref, toRef, watch } from "vue";
import { useArtworkSize } from "@/features/artwork/useArtworkSize";
import { useTrackArtwork } from "@/features/artwork/track/useArtwork";

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

const coverElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const size = useArtworkSize(coverElement);
const { status, url } = useTrackArtwork(toRef(props, "trackId"), size);
const emit = defineEmits<{ status: [status: "loading" | "ready" | "fallback"] }>();
watch(status, (value) => emit("status", value), { immediate: true });
</script>
