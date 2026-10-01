<template>
  <li class="min-w-0 border-b border-white/10">
    <button
      data-item-interaction
      data-album-track-row
      class="focus-visible:bg-spotify-track flex w-full min-w-0 items-center gap-3 rounded-md py-2.5 pr-3 text-left text-sm transition-colors outline-none"
      :class="
        props.isFocused ? 'bg-spotify-track' : props.isSelected ? 'bg-white/10' : 'hover:bg-white/5'
      "
      :aria-pressed="props.isSelected ? true : undefined"
      aria-haspopup="menu"
      :aria-expanded="props.isContextMenuOpen"
      :aria-controls="props.isContextMenuOpen ? 'album-track-context-menu' : undefined"
      type="button"
      @click="handleSelect"
      @dblclick="emit('play')"
      @contextmenu="openTrackContextMenu"
      @keydown="handleContextMenuKeydown"
    >
      <span class="text-spotify-muted w-5 shrink-0 text-right tabular-nums">
        {{ props.index + 1 }}
      </span>
      <AudioLines
        v-if="props.isCurrentTrack"
        aria-hidden="true"
        class="text-spotify-green size-4 shrink-0"
      />
      <span
        data-album-track-label
        class="min-w-0 flex-1 truncate font-medium"
        :title="trackLabel"
        :class="props.isCurrentTrack ? 'text-spotify-green' : 'text-white'"
      >
        <span data-album-track-content class="inline-block">
          {{ props.track.title ?? "未知曲目"
          }}<span v-if="showArtist" class="text-spotify-muted ml-3 font-normal"
            >[{{ props.track.artist }}]</span
          >
        </span>
      </span>
      <span class="text-spotify-muted shrink-0 tabular-nums">
        {{ formatTrackDuration(props.track.durationMs) ?? "时长未知" }}
      </span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { AudioLines } from "@lucide/vue";
import type { ItemSelectionModifiers } from "@/interaction/itemFocus";
import type { TrackSummary } from "@/types/track.ts";
import { formatTrackDuration } from "@/utils/formatTrack.ts";

const props = defineProps<{
  track: TrackSummary;
  albumArtist: string | null;
  index: number;
  isFocused: boolean;
  isSelected: boolean;
  isCurrentTrack: boolean;
  isContextMenuOpen: boolean;
}>();

const showArtist = computed(
  () => Boolean(props.track.artist) && props.track.artist !== props.albumArtist,
);
const trackLabel = computed(() => {
  const title = props.track.title ?? "未知曲目";
  return showArtist.value ? `${title} [${props.track.artist}]` : title;
});

const emit = defineEmits<{
  select: [modifiers: ItemSelectionModifiers];
  play: [];
  contextMenu: [
    request: {
      trackId: number;
      x: number;
      y: number;
      trigger: InstanceType<typeof globalThis.HTMLButtonElement>;
    },
  ];
}>();

function handleSelect(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (event.button !== 0) return;
  emit("select", { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey });
}

function openTrackContextMenu(event: InstanceType<typeof globalThis.MouseEvent>) {
  event.preventDefault();
  event.stopPropagation();
  emit("contextMenu", {
    trackId: props.track.id,
    x: event.clientX,
    y: event.clientY,
    trigger: event.currentTarget as InstanceType<typeof globalThis.HTMLButtonElement>,
  });
}

function handleContextMenuKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;

  event.preventDefault();
  event.stopPropagation();
  const trigger = event.currentTarget as InstanceType<typeof globalThis.HTMLButtonElement>;
  const bounds = trigger.getBoundingClientRect();
  emit("contextMenu", {
    trackId: props.track.id,
    x: bounds.left,
    y: bounds.bottom,
    trigger,
  });
}
</script>
