<script setup lang="ts">
import { nextTick, ref } from "vue";
import { ChevronRight } from "@lucide/vue";
import { createPlaylistApi } from "@/features/playlist/api";
import { createPlaylistAppend } from "@/features/playlist/tracks/append";
import type { PlaylistSummary } from "@/features/playlist/types";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

const props = defineProps<{ trackIds: readonly number[]; disabled?: boolean }>();
const emit = defineEmits<{ close: []; create: [trackIds: number[]] }>();
const api = createPlaylistApi();
const append = createPlaylistAppend(api);
const trigger = ref<globalThis.HTMLButtonElement | null>(null);
const submenu = ref<globalThis.HTMLDivElement | null>(null);
const first = ref<globalThis.HTMLButtonElement | null>(null);
const open = ref(false);
const loading = ref(false);
const pending = ref(false);
const playlists = ref<PlaylistSummary[]>([]);
const position = ref({ x: 0, y: 0 });

function report(error: unknown) {
  logger.error("playlist", "append_failed", error);
  notify({ type: "error", message: t("歌单操作失败") });
}
async function show(focus = false) {
  if (props.disabled || !props.trackIds.length) return;
  open.value = true;
  if (!loading.value) {
    loading.value = true;
    try {
      playlists.value = await api.list();
    } catch (error) {
      report(error);
    } finally {
      loading.value = false;
    }
  }
  await nextTick();
  const bounds = trigger.value?.getBoundingClientRect();
  const menu = submenu.value?.getBoundingClientRect();
  if (bounds && menu) {
    position.value = {
      x: Math.max(
        0,
        bounds.right + menu.width <= globalThis.innerWidth
          ? bounds.right
          : bounds.left - menu.width,
      ),
      y: Math.max(0, Math.min(bounds.top, globalThis.innerHeight - menu.height)),
    };
  }
  if (focus && open.value) first.value?.focus();
}
function create() {
  if (props.disabled || pending.value) return;
  const ids = [...props.trackIds];
  emit("close");
  emit("create", ids);
}
async function add(playlistId: number) {
  if (props.disabled || pending.value) return;
  const ids = [...props.trackIds];
  pending.value = true;
  emit("close");
  try {
    const result = await append(playlistId, ids);
    if (result.error) report(result.error);
  } catch (error) {
    report(error);
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div
    @pointerleave="open = false"
    @keydown.left.stop.prevent="
      open = false;
      trigger?.focus();
    "
  >
    <button
      ref="trigger"
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      :aria-expanded="open"
      :disabled="disabled || pending || !trackIds.length"
      class="focus-visible:outline-app-accent flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
      @mouseenter="show()"
      @click.stop="show(true)"
      @keydown.right.stop.prevent="show(true)"
    >
      {{ t("添加到播放列表") }}
      <ChevronRight aria-hidden="true" class="size-4" />
    </button>
    <div
      v-if="open"
      ref="submenu"
      role="menu"
      :aria-label="t('选择目标歌单')"
      class="bg-app-interactive fixed z-101 max-h-72 w-56 overflow-y-auto rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    >
      <button
        ref="first"
        type="button"
        role="menuitem"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
        @click.stop="create"
      >
        {{ t("新建播放列表…") }}
      </button>
      <div class="my-1 border-t border-white/10" role="separator" />
      <button
        v-for="playlist in loading ? [] : playlists"
        :key="playlist.id"
        type="button"
        role="menuitem"
        class="focus-visible:outline-app-accent w-full truncate rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
        @click.stop="add(playlist.id)"
      >
        {{ playlist.name }}
      </button>
    </div>
  </div>
</template>
