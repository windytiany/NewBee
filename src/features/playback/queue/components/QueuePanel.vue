<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import QueueList from "@/features/playback/queue/components/QueueList.vue";
import { usePlaybackSession } from "@/features/playback/session";

const { state, playQueueItem, removeQueueItems, addTracksToQueueEnd } = usePlaybackSession();
const { displayedTracks, skippedTrackIds, activeQueueRowKey } = state;
</script>

<template>
  <QueueList
    :tracks="displayedTracks"
    :skipped-track-ids="skippedTrackIds"
    :current-row-key="activeQueueRowKey"
    :can-remove-from-queue="true"
    :title="t('当前曲目列表')"
    :empty-message="t('无曲目')"
    @play-queue-item="playQueueItem"
    @remove-queue-items="removeQueueItems"
    @add-tracks-to-queue-end="addTracksToQueueEnd"
  />
</template>
