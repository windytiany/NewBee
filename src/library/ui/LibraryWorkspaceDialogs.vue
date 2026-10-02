<script setup lang="ts">
import DeleteAlbumDialog from "@/library/ui/DeleteAlbumDialog.vue";
import DeleteTrackDialog from "@/library/ui/DeleteTrackDialog.vue";
import type { LibraryWorkspace } from "@/library/useLibraryWorkspace";

defineProps<{ workspace: LibraryWorkspace }>();
</script>

<template>
  <DeleteAlbumDialog
    v-if="workspace.deleteAlbumTarget"
    :ref="workspace.elements.deleteAlbumDialog"
    :album="workspace.deleteAlbumTarget"
    :pending="workspace.page.isTrackActionPending"
    @confirm="workspace.confirmAlbumDeletion"
    @cancel="workspace.cancelAlbumDeletion"
  />
  <DeleteTrackDialog
    v-if="workspace.deleteTrackTarget"
    :ref="workspace.elements.deleteTrackDialog"
    :track="workspace.deleteTrackTarget"
    :is-deleting="workspace.page.isTrackActionPending"
    @confirm="workspace.confirmTrackDeletion"
    @cancel="workspace.cancelTrackDeletion"
  />
</template>
