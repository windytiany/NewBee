<template>
  <section
    aria-label="专辑演出者列表"
    class="bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col text-white"
  >
    <div ref="groupingControl" class="relative z-10 shrink-0 px-2 py-1">
      <button
        ref="groupingButton"
        aria-controls="grouping-options"
        aria-haspopup="menu"
        class="focus-visible:outline-spotify-green flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm font-medium text-white/90 transition-colors hover:bg-white/5 focus-visible:outline-2"
        :aria-expanded="isGroupingMenuOpen"
        type="button"
        @click="isGroupingMenuOpen = !isGroupingMenuOpen"
      >
        <span>专辑演出者</span>
        <ChevronDown
          aria-hidden="true"
          class="text-spotify-muted size-4 transition-transform"
          :class="isGroupingMenuOpen ? 'rotate-180' : ''"
        />
      </button>

      <div
        v-if="isGroupingMenuOpen"
        id="grouping-options"
        class="bg-spotify-interactive absolute top-full right-2 left-2 rounded-md p-1 shadow-xl ring-1 ring-white/10"
        role="menu"
        aria-label="分组方式"
      >
        <button
          aria-checked="true"
          class="focus-visible:outline-spotify-green flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
          role="menuitemradio"
          type="button"
          @click="isGroupingMenuOpen = false"
        >
          <Check aria-hidden="true" class="text-spotify-green size-4" />
          <span>专辑演出者</span>
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <ul class="space-y-0.5">
        <GroupListItem
          v-for="artist in props.artists"
          :key="artist.name"
          :name="artist.name"
          :album-count="artist.albumCount"
          :is-focused="props.selectedArtist?.name === artist.name"
          @select="emit('select', artist)"
        />
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Check, ChevronDown } from "@lucide/vue";
import type { Artist } from "../../types/artist";
import GroupListItem from "./GroupListItem.vue";

const props = defineProps<{
  artists: Artist[];
  selectedArtist: Artist | null;
}>();

const emit = defineEmits<{
  select: [artist: Artist];
}>();

const isGroupingMenuOpen = ref(false);
const groupingControl = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const groupingButton = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
function closeMenuOnOutsidePointer(event: InstanceType<typeof globalThis.PointerEvent>) {
  if (event.target instanceof globalThis.Node && groupingControl.value?.contains(event.target))
    return;
  isGroupingMenuOpen.value = false;
}

function closeMenuOnEscape(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (event.key !== "Escape" || !isGroupingMenuOpen.value) return;

  isGroupingMenuOpen.value = false;
  groupingButton.value?.focus();
}

onMounted(() => {
  globalThis.document.addEventListener("pointerdown", closeMenuOnOutsidePointer);
  globalThis.document.addEventListener("keydown", closeMenuOnEscape);
});

onUnmounted(() => {
  globalThis.document.removeEventListener("pointerdown", closeMenuOnOutsidePointer);
  globalThis.document.removeEventListener("keydown", closeMenuOnEscape);
});
</script>
