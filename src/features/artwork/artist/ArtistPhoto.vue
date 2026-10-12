<template>
  <span
    ref="photoElement"
    class="bg-app-interactive text-app-muted flex shrink-0 items-center justify-center overflow-hidden rounded-full"
  >
    <img
      v-if="url && !failed"
      :src="url"
      alt=""
      class="h-full w-full object-cover"
      @error="failed = true"
    />
    <UserRound v-else aria-hidden="true" class="h-1/2 w-1/2" />
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { UserRound } from "@lucide/vue";
import { usePhoto } from "@/features/artwork/artist/usePhoto";

const props = defineProps<{ artist: string | null }>();
const photoElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const activated = ref(false);
const { url } = usePhoto(() => (activated.value ? props.artist : null));
let observer: InstanceType<typeof globalThis.IntersectionObserver> | null = null;
onMounted(() => {
  if (!globalThis.IntersectionObserver) {
    activated.value = true;
    return;
  }
  observer = new globalThis.IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    activated.value = true;
    observer?.disconnect();
  });
  if (photoElement.value) observer.observe(photoElement.value);
});
onBeforeUnmount(() => observer?.disconnect());
const failed = ref(false);
watch(url, () => {
  failed.value = false;
});
</script>
