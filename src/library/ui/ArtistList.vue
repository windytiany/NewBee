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
      <p
        v-if="props.isLoading && props.artists.length === 0"
        class="text-spotify-muted px-2 py-3 text-sm"
        role="status"
      >
        正在读取专辑演出者…
      </p>
      <p
        v-else-if="!props.isLoading && !props.error && props.artists.length === 0"
        class="text-spotify-muted px-2 py-3 text-sm"
      >
        音乐库中暂无专辑演出者。
      </p>
      <ul v-if="props.artists.length > 0" class="space-y-0.5">
        <ArtistListItem
          v-for="artist in props.artists"
          :key="getArtistKey(artist.albumArtist)"
          :name="artist.albumArtist ?? '未知演出者'"
          :album-count="artist.albumCount"
          :is-selected="isSelectedArtist(artist)"
          :is-focused="artistFocus.isFocused(getArtistKey(artist.albumArtist))"
          @select="selectArtist(artist)"
        />
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Check, ChevronDown } from "@lucide/vue";
import { useItemFocusList } from "@/interaction/itemFocus";
import type { AlbumArtistSummary } from "@/types/artist";
import ArtistListItem from "@/library/ui/ArtistListItem.vue";

const props = defineProps<{
  artists: AlbumArtistSummary[];
  selectedArtist: AlbumArtistSummary | null;
  isLoading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  select: [artist: AlbumArtistSummary];
}>();

const artistListScope = "library:artist-navigation";
const artistFocus = useItemFocusList(artistListScope);
const artistItemKeys = computed(() =>
  props.artists.map((artist) => getArtistKey(artist.albumArtist)),
);

watch(artistItemKeys, (itemKeys) => artistFocus.syncVisibleItems(itemKeys), { immediate: true });

function getArtistKey(albumArtist: string | null) {
  return JSON.stringify([albumArtist]);
}

function isSelectedArtist(artist: AlbumArtistSummary) {
  return props.selectedArtist?.albumArtist === artist.albumArtist;
}

function selectArtist(artist: AlbumArtistSummary) {
  artistFocus.focusItem(getArtistKey(artist.albumArtist));
  emit("select", artist);
}

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
