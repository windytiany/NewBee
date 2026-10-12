<template>
  <span
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
import { ref, watch } from "vue";
import { UserRound } from "@lucide/vue";
import { usePhoto } from "@/features/artwork/artist/usePhoto";

const props = defineProps<{ artist: string | null }>();
const { url } = usePhoto(() => props.artist);
const failed = ref(false);
watch(url, () => {
  failed.value = false;
});
</script>
