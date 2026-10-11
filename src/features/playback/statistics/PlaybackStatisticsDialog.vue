<script setup lang="ts">
import { X } from "@lucide/vue";
import { ref } from "vue";
import { t } from "@/shared/i18n/locale";
import { usePlaybackStatistics } from "@/features/playback/statistics/usePlaybackStatistics";

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const {
  tracks,
  isOpen,
  isLoading,
  loadFailed,
  open,
  close: closeStatistics,
} = usePlaybackStatistics();

function show() {
  if (isOpen.value) return;
  dialogElement.value?.showModal();
  void open();
}

function close() {
  dialogElement.value?.close();
  closeStatistics();
}

defineExpose({ show });
</script>

<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="playback-statistics-title"
    class="bg-app-surface m-auto max-h-[85vh] w-[min(60rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel.prevent="close"
    @close="closeStatistics"
    @click.self="close"
    @mousedown.stop
  >
    <header class="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
      <h2 id="playback-statistics-title" class="text-lg font-semibold">{{ t("播放统计") }}</h2>
      <button
        type="button"
        autofocus
        :aria-label="t('关闭')"
        class="focus-visible:outline-app-accent text-app-muted inline-flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10 hover:text-white focus-visible:outline-2"
        @click="close"
      >
        <X aria-hidden="true" class="size-4" />
      </button>
    </header>
    <div class="max-h-[calc(85vh-5rem)] overflow-auto" :aria-busy="isLoading">
      <p v-if="isLoading && !tracks.length" role="status" class="text-app-muted px-5 py-4 text-sm">
        {{ t("正在加载…") }}
      </p>
      <p
        v-else-if="!tracks.length && !loadFailed"
        role="status"
        class="text-app-muted px-5 py-4 text-sm"
      >
        {{ t("暂无播放统计") }}
      </p>
      <table v-if="tracks.length" class="w-full min-w-[36rem] table-fixed text-left text-sm">
        <thead class="bg-app-surface text-app-muted sticky top-0">
          <tr>
            <th scope="col" class="w-[30%] px-5 py-3 font-medium">{{ t("歌曲名") }}</th>
            <th scope="col" class="w-[25%] px-5 py-3 font-medium">{{ t("歌手") }}</th>
            <th scope="col" class="w-[30%] px-5 py-3 font-medium">{{ t("专辑名") }}</th>
            <th scope="col" class="w-[15%] px-5 py-3 text-right font-medium">
              {{ t("播放次数") }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-white/5">
          <tr v-for="track in tracks" :key="track.trackId">
            <td class="px-5 py-3 wrap-anywhere">{{ track.title || t("未知曲目") }}</td>
            <td class="text-app-muted px-5 py-3 wrap-anywhere">
              {{ track.artist || t("未知艺术家") }}
            </td>
            <td class="text-app-muted px-5 py-3 wrap-anywhere">
              {{ track.album || t("未知专辑") }}
            </td>
            <td class="px-5 py-3 text-right tabular-nums">{{ track.playCount }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </dialog>
</template>
