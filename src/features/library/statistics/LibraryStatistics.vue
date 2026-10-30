<script setup lang="ts">
import { ref } from "vue";
import type { AlbumSummary } from "@/features/library/types";
import ResizeHandle from "@/shared/interaction/resize/ResizeHandle.vue";
import { useWidth } from "@/features/library/statistics/useWidth";
import { useStatistics } from "@/features/library/statistics/useStatistics";
import { t } from "@/shared/i18n/locale";

const props = defineProps<{ albums: AlbumSummary[] }>();
const { tracks, visible, isLoading, loadFailed } = useStatistics(() => props.albums);
const paneElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const { width, minWidth, maxWidth, resize } = useWidth(paneElement);
</script>

<template>
  <div
    v-if="visible"
    ref="paneElement"
    class="flex min-h-0 min-w-0 shrink-0 overflow-hidden"
    :style="{ width: `${width}px` }"
  >
    <ResizeHandle
      :label="t('调整统计栏宽度')"
      orientation="vertical"
      reverse
      class="shrink-0"
      :value="width"
      :min-value="minWidth"
      :max-value="maxWidth"
      @resize="resize"
    />
    <aside
      :aria-label="t('最常播放曲目')"
      :aria-busy="isLoading"
      class="sidebar-scrollbars min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain border-l border-white/10 px-3 py-3 text-sm"
    >
      <h2 class="text-app-muted mb-3 font-medium">{{ t("最常播放曲目") }}</h2>
      <p v-if="isLoading && !tracks.length" role="status" class="text-app-muted">
        {{ t("正在加载…") }}
      </p>
      <p v-else-if="loadFailed && !tracks.length" role="status" class="text-app-muted">
        {{ t("读取播放统计失败") }}
      </p>
      <p v-else-if="!tracks.length" role="status" class="text-app-muted">{{ t("暂无播放记录") }}</p>
      <ol v-else class="space-y-2">
        <li v-for="track in tracks" :key="track.trackId" class="flex items-baseline gap-3">
          <span class="min-w-0 flex-1 truncate">{{ track.title || t("未知曲目") }}</span>
          <span class="text-app-muted shrink-0 tabular-nums" :aria-label="t('播放次数')">{{
            track.playCount
          }}</span>
        </li>
      </ol>
    </aside>
  </div>
</template>
