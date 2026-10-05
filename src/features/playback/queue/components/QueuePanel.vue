<script setup lang="ts">
import QueueList from "@/features/playback/queue/components/QueueList.vue";
import { usePlaybackSession } from "@/features/playback/session";

const { state, playQueueItem, removeQueueItems } = usePlaybackSession();
const { displayedTracks, skippedTrackIds, activeQueueRowKey } = state;
</script>

<template>
  <QueueList
    :tracks="displayedTracks"
    :skipped-track-ids="skippedTrackIds"
    :current-row-key="activeQueueRowKey"
    :can-remove-from-queue="true"
    title="当前曲目列表"
    empty-message="无曲目"
    @play-queue-item="playQueueItem"
    @remove-queue-items="removeQueueItems"
  />
</template>
