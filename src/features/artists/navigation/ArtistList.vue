<template>
  <section
    :aria-label="t(props.grouping === 'artist' ? '演出者列表' : '专辑演出者列表')"
    class="bg-app-base flex h-full min-h-0 w-full min-w-0 flex-col text-white"
  >
    <div ref="groupingControl" class="relative z-10 shrink-0 px-2 py-1">
      <button
        ref="groupingButton"
        aria-controls="grouping-options"
        aria-haspopup="menu"
        class="focus-visible:outline-app-accent flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm font-medium text-white/90 transition-colors hover:bg-white/5 focus-visible:outline-2"
        :aria-expanded="isGroupingMenuOpen"
        type="button"
        @click="isGroupingMenuOpen = !isGroupingMenuOpen"
      >
        <span>{{ t(props.grouping === "artist" ? "演出者" : "专辑演出者") }}</span>
        <ChevronDown
          aria-hidden="true"
          class="text-app-muted size-4 transition-transform"
          :class="isGroupingMenuOpen ? 'rotate-180' : ''"
        />
      </button>

      <div
        v-if="isGroupingMenuOpen"
        id="grouping-options"
        class="bg-app-interactive absolute top-full right-2 left-2 rounded-md p-1 shadow-xl ring-1 ring-white/10"
        role="menu"
        :aria-label="t('分组方式')"
      >
        <button
          v-for="option in groupingOptions"
          :key="option.value"
          :aria-checked="props.grouping === option.value"
          class="focus-visible:outline-app-accent flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
          role="menuitemradio"
          type="button"
          @click="selectGrouping(option.value)"
        >
          <Check
            aria-hidden="true"
            class="text-app-accent size-4"
            :class="{ invisible: props.grouping !== option.value }"
          />
          <span>{{ t(option.label) }}</span>
        </button>
      </div>
    </div>

    <div
      v-persistent-scroll="`${props.scope}:artists:${props.grouping}`"
      class="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
    >
      <p
        v-if="!props.allArtists && !props.isLoading && !props.error && props.artists.length === 0"
        class="text-app-muted px-2 py-3 text-sm"
      >
        {{ t("无演出者") }}
      </p>
      <ul
        v-if="props.allArtists || props.artists.length > 0"
        class="space-y-0.5"
        @keydown="artistKeyboard.onKeydown"
        @focusin="artistKeyboard.onFocusin"
      >
        <li v-if="props.allArtists">
          <button
            data-item-interaction
            type="button"
            class="focus-visible:bg-app-track w-full rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-white/5"
            :class="{ 'bg-app-track': artistFocus.isFocused('all') }"
            :aria-current="props.selectedArtist === null ? 'true' : undefined"
            @click="selectAll"
          >
            {{ t("所有艺术家") }}
          </button>
        </li>
        <ArtistRow
          v-for="artist in props.artists"
          :key="getArtistKey(artist.artist)"
          :artist="artist.artist"
          :show-photo="props.showPhotos"
          :name="artist.artist ?? t('未知演出者')"
          :album-count="artist.albumCount"
          :is-selected="isSelectedArtist(artist)"
          :is-focused="artistFocus.isFocused(getArtistKey(artist.artist))"
          @select="selectArtist(artist)"
        />
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Check, ChevronDown } from "@lucide/vue";
import { useItemSelection } from "@/shared/interaction/item/useSelection";
import { vPersistentScroll } from "@/shared/interaction/scroll/persistence";
import { createItemKeyboard } from "@/shared/interaction/item/keyboard";
import type { ArtistSummary, LibraryGrouping } from "@/features/library/types";
import ArtistRow from "@/features/artists/navigation/ArtistRow.vue";

const props = withDefaults(
  defineProps<{
    artists: ArtistSummary[];
    selectedArtist: ArtistSummary | null;
    grouping: LibraryGrouping;
    isLoading: boolean;
    error: string;
    scope?: string;
    showPhotos?: boolean;
    allArtists?: boolean;
  }>(),
  { scope: "artists", showPhotos: true, allArtists: false },
);

const emit = defineEmits<{
  select: [artist: ArtistSummary];
  selectGrouping: [grouping: LibraryGrouping];
  selectAll: [];
}>();

const groupingOptions = [
  { value: "albumArtist", label: "专辑演出者" },
  { value: "artist", label: "演出者" },
] as const;

const artistListScope = computed(() => `${props.scope}:artist-navigation:${props.grouping}`);
const artistFocus = useItemSelection(artistListScope);
const artistItemKeys = computed(() => [
  ...(props.allArtists ? ["all"] : []),
  ...props.artists.map((artist) => getArtistKey(artist.artist)),
]);

const artistKeyboard = createItemKeyboard({
  getItemKeys: () => artistItemKeys.value,
  itemSelector: "button[data-item-interaction]",
  onFocus: (key) => {
    if (!artistFocus.isFocused(key)) artistFocus.focusItem(key);
  },
  onMove: (key) => {
    if (key === "all") {
      selectAll();
      return;
    }
    const artist = props.artists.find((entry) => getArtistKey(entry.artist) === key);
    if (artist) selectArtist(artist);
  },
});

watch(artistItemKeys, (itemKeys) => artistFocus.syncVisibleItems(itemKeys), { immediate: true });

function getArtistKey(artist: string | null) {
  return JSON.stringify([artist]);
}

function isSelectedArtist(artist: ArtistSummary) {
  return props.selectedArtist !== null && props.selectedArtist.artist === artist.artist;
}

function selectArtist(artist: ArtistSummary) {
  artistFocus.focusItem(getArtistKey(artist.artist));
  emit("select", artist);
}

function selectAll() {
  artistFocus.focusItem("all");
  emit("selectAll");
}

function selectGrouping(grouping: LibraryGrouping) {
  isGroupingMenuOpen.value = false;
  emit("selectGrouping", grouping);
  groupingButton.value?.focus();
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
