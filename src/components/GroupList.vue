<template>
  <section
    aria-label="专辑演出者列表"
    class="flex h-full min-h-0 w-full min-w-0 flex-col bg-spotify-base text-white"
  >
    <div ref="groupingControl" class="relative z-10 shrink-0 px-2 py-1">
      <button
        ref="groupingButton"
        aria-controls="grouping-options"
        aria-haspopup="menu"
        class="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm font-medium text-white/90 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-spotify-green"
        :aria-expanded="isGroupingMenuOpen"
        type="button"
        @click="isGroupingMenuOpen = !isGroupingMenuOpen"
      >
        <span>专辑演出者</span>
        <ChevronDown
          aria-hidden="true"
          class="size-4 text-spotify-muted transition-transform"
          :class="isGroupingMenuOpen ? 'rotate-180' : ''"
        />
      </button>

      <div
        v-if="isGroupingMenuOpen"
        id="grouping-options"
        class="absolute left-2 right-2 top-full rounded-md bg-spotify-interactive p-1 shadow-xl ring-1 ring-white/10"
        role="menu"
        aria-label="分组方式"
      >
        <button
          aria-checked="true"
          class="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-spotify-green"
          role="menuitemradio"
          type="button"
          @click="isGroupingMenuOpen = false"
        >
          <Check aria-hidden="true" class="size-4 text-spotify-green" />
          <span>专辑演出者</span>
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <button
        :aria-current="focusedItem === ALL_ARTISTS_KEY ? 'true' : undefined"
        class="mb-1 flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-spotify-green"
        :class="focusedItem === ALL_ARTISTS_KEY ? 'bg-spotify-interactive' : 'hover:bg-white/5'"
        type="button"
        @click="setFocusedItem(ALL_ARTISTS_KEY)"
      >
        <span
          aria-hidden="true"
          class="grid size-16 shrink-0 place-items-center rounded-sm bg-[#292929] text-spotify-muted"
        >
          <UsersRound class="size-8" />
        </span>
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="truncate text-base font-medium">所有演出者</span>
          <span class="text-sm text-spotify-muted">180 张专辑</span>
        </span>
      </button>

      <ul class="space-y-0.5">
        <GroupListItem
          v-for="artist in artists"
          :key="artist.name"
          :name="artist.name"
          :album-count="artist.albumCount"
          :is-focused="focusedItem === getArtistFocusKey(artist.name)"
          @select="setFocusedItem(getArtistFocusKey(artist.name))"
        />
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Check, ChevronDown, UsersRound } from "@lucide/vue";
import { useClickFocus } from "../composables/useClickFocus";
import GroupListItem from "./GroupListItem.vue";

const isGroupingMenuOpen = ref(false);
const { focusedItem, setFocusedItem } = useClickFocus();
const ALL_ARTISTS_KEY = "group:all-artists";
const groupingControl = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const groupingButton = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
const artists = [
  { name: "[Singles]", albumCount: 27 },
  { name: "American Football", albumCount: 1 },
  { name: "Bark Psychosis", albumCount: 3 },
  { name: "The Beatles", albumCount: 1 },
  { name: "Bob Dylan", albumCount: 2 },
  { name: "Chinese Football", albumCount: 2 },
  { name: "The Clash", albumCount: 1 },
  { name: "The Cure", albumCount: 2 },
  { name: "Deep Purple", albumCount: 1 },
  { name: "The Doors", albumCount: 1 },
  { name: "Dormir", albumCount: 1 },
  { name: "Draw the Emotional", albumCount: 2 },
  { name: "Elliott Smith", albumCount: 3 },
  { name: "Fiona Apple", albumCount: 2 },
  { name: "Godspeed You! Black Emperor", albumCount: 4 },
  { name: "Radiohead", albumCount: 9 },
  { name: "The Smashing Pumpkins", albumCount: 6 },
  { name: "The Strokes", albumCount: 4 },
];

function getArtistFocusKey(name: string) {
  return `group:${name}`;
}

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
