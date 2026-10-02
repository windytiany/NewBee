<script setup lang="ts">
import CreatePlaylistDialog from "@/playlist/ui/CreatePlaylistDialog.vue";
import DeletePlaylistDialog from "@/playlist/ui/DeletePlaylistDialog.vue";
import RenamePlaylistDialog from "@/playlist/ui/RenamePlaylistDialog.vue";
import type { PlaylistWorkspace } from "@/playlist/usePlaylistWorkspace";

defineProps<{ workspace: PlaylistWorkspace; active: boolean }>();
</script>

<template>
  <CreatePlaylistDialog
    v-if="active"
    :ref="workspace.elements.createPlaylistDialog"
    @created="workspace.onPlaylistCreated"
  />
  <RenamePlaylistDialog
    v-if="workspace.managementDialogType === 'rename' && workspace.managementPlaylist"
    :ref="workspace.elements.renamePlaylistDialog"
    :playlist="workspace.managementPlaylist"
    :is-pending="workspace.managementPlaylistPending"
    @confirm="workspace.confirmPlaylistRename"
    @cancel="workspace.cancelPlaylistManagement"
  />
  <DeletePlaylistDialog
    v-if="workspace.managementDialogType === 'delete' && workspace.managementPlaylist"
    :ref="workspace.elements.deletePlaylistDialog"
    :playlist="workspace.managementPlaylist"
    :is-pending="workspace.managementPlaylistPending"
    @confirm="workspace.confirmPlaylistDeletion"
    @cancel="workspace.cancelPlaylistManagement"
  />
</template>
