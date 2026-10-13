<script setup lang="ts">
import { ref, watch } from "vue";
import { createLibraryApi } from "@/features/library/api";
import { createTracksApi } from "@/features/tracks/api";
import { useLibraryFileImport } from "@/features/library/import/useFileImport";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

const props = defineProps<{ trackIds: readonly number[]; disabled?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const api = createLibraryApi();
const tracks = createTracksApi();
const importer = useLibraryFileImport();
const externalIds = ref<number[]>([]);
const loading = ref(false);
let generation = 0;
function report(error: unknown) {
  logger.error("library", "import_targets_failed", error);
  notify({ type: "error", message: t("添加到音乐库失败") });
}
watch(
  () => props.trackIds,
  async (ids) => {
    const request = ++generation;
    externalIds.value = [];
    loading.value = true;
    try {
      const external = await api.listExternalTrackIds(ids);
      if (request === generation) externalIds.value = external;
    } catch (error) {
      if (request === generation) report(error);
    } finally {
      if (request === generation) loading.value = false;
    }
  },
  { immediate: true },
);
async function ingest() {
  if (props.disabled || loading.value || importer.isImporting.value || !externalIds.value.length)
    return;
  const ids = [...externalIds.value];
  emit("close");
  try {
    const targets = await tracks.getTracks(ids);
    if (targets.length !== ids.length) throw new Error("Missing library import targets");
    await importer.importPaths(targets.map((track) => track.path));
  } catch (error) {
    report(error);
  }
}
</script>

<template>
  <button
    v-if="externalIds.length"
    type="button"
    role="menuitem"
    :disabled="disabled || loading || importer.isImporting.value"
    class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
    @click.stop="ingest"
  >
    {{ t("添加到音乐库") }}
  </button>
</template>
