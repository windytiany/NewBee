<template>
  <button
    class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
    role="menuitem"
    :disabled="props.disabled || !isReady || isTrackSkipPending || props.trackIds.length === 0"
    type="button"
    @click.stop="setSkipped"
  >
    {{ allSkipped ? "取消跳过" : "跳过" }}
  </button>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { usePlaybackSession } from "@/playback/session";
import { notify } from "@/notification/center";

const props = withDefaults(defineProps<{ trackIds: readonly number[]; disabled?: boolean }>(), {
  disabled: false,
});
const emit = defineEmits<{ close: [] }>();
const session = usePlaybackSession();
const { skippedTrackIds, isTrackSkipPending } = session.state;
const isReady = ref(false);
const allSkipped = computed(
  () =>
    props.trackIds.length > 0 && props.trackIds.every((id) => skippedTrackIds.value.includes(id)),
);

function reportError(error: unknown) {
  notify({
    type: "error",
    message: `更新跳过标记失败：${error instanceof Error ? error.message : String(error)}`,
    key: "track-skip",
  });
}

void session
  .loadTrackSkipPreferences()
  .then(() => {
    isReady.value = true;
  })
  .catch(reportError);

async function setSkipped() {
  if (props.disabled || !isReady.value || isTrackSkipPending.value || props.trackIds.length === 0)
    return;
  const trackIds = [...props.trackIds];
  const skipped = !allSkipped.value;
  emit("close");
  try {
    await session.setTracksSkipped(trackIds, skipped);
  } catch (error) {
    reportError(error);
  }
}
</script>
