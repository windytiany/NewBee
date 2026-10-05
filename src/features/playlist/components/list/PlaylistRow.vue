<template>
  <li>
    <button
      data-item-interaction
      :data-playlist-id="playlistId"
      class="focus-visible:bg-app-track flex w-full min-w-0 items-center rounded-md px-1 py-1.5 text-left transition-colors outline-none"
      :class="isFocused ? 'bg-app-track' : 'hover:bg-white/5'"
      :aria-current="isSelected ? 'true' : undefined"
      aria-haspopup="menu"
      :aria-expanded="isContextMenuOpen"
      :aria-controls="isContextMenuOpen ? 'playlist-list-context-menu' : undefined"
      type="button"
      @click="emit('select')"
      @contextmenu="openContextMenu"
      @keydown="handleContextMenuKeydown"
    >
      <TrackArtwork :track-id="coverTrackId" alt="" class="mr-2 size-10 shrink-0 rounded-md">
        <div
          aria-hidden="true"
          class="grid h-full w-full place-items-center rounded-md bg-linear-to-br from-violet-800 via-indigo-950 to-slate-950"
        >
          <DiscAlbum aria-hidden="true" class="size-5 text-white/75" stroke-width="1.25" />
        </div>
      </TrackArtwork>
      <span class="text-app-muted min-w-0 flex-1 truncate text-base">
        {{ name }}
      </span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { DiscAlbum } from "@lucide/vue";
import TrackArtwork from "@/features/artwork/components/TrackArtwork.vue";

const props = defineProps<{
  playlistId: number;
  name: string;
  coverTrackId: number | null;
  isFocused: boolean;
  isSelected: boolean;
  isContextMenuOpen: boolean;
}>();

const emit = defineEmits<{
  select: [];
  contextMenu: [
    request: {
      playlistId: number;
      x: number;
      y: number;
      trigger: InstanceType<typeof globalThis.HTMLButtonElement>;
    },
  ];
}>();

function openContextMenu(event: InstanceType<typeof globalThis.MouseEvent>) {
  event.preventDefault();
  event.stopPropagation();
  emit("contextMenu", {
    playlistId: props.playlistId,
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
    playlistId: props.playlistId,
    x: bounds.left,
    y: bounds.bottom,
    trigger,
  });
}
</script>
