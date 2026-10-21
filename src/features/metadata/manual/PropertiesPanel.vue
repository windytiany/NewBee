<template>
  <section id="metadata-panel-properties" role="tabpanel" aria-labelledby="metadata-tab-properties">
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-4 text-sm">
      <template v-for="property in properties" :key="property.label">
        <dt class="text-app-muted">{{ property.label }}</dt>
        <dd class="break-all">{{ property.value }}</dd>
      </template>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { t } from "@/shared/i18n/locale";
import type { EditorTrack } from "@/features/metadata/types";
import { formatTrackDuration } from "@/features/tracks/format";
import { formatPathForDisplay } from "@/shared/filesystem/presentation";
const props = defineProps<{ track: EditorTrack }>();
const properties = computed(() => {
  const track = props.track;
  if (!track) return [];
  return [
    { label: t("位置"), value: formatPathForDisplay(track.path) },
    { label: t("时长"), value: formatTrackDuration(track.durationMs) ?? "-" },
    { label: t("编码"), value: track.codec ?? "-" },
    { label: t("采样率"), value: track.sampleRateHz === null ? "-" : `${track.sampleRateHz} Hz` },
    { label: t("码率"), value: track.bitrateKbps === null ? "-" : `${track.bitrateKbps} kbps` },
    { label: t("声道"), value: track.channels ?? "-" },
  ];
});
</script>
