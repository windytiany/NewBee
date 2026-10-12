<script setup lang="ts">
import { shallowRef } from "vue";
import { useDropImport } from "@/features/import/useDropImport";
import { usePersistentActivePage } from "@/app/pages";
import { useShortcuts } from "@/features/settings/shortcuts/useShortcuts";
import type { PlaylistCatalog } from "@/features/playlist/types";
import LibraryPage from "@/features/library/pages/LibraryPage.vue";
import PlaylistPage from "@/features/playlist/pages/PlaylistPage.vue";
import InboxPage from "@/features/inbox/pages/InboxPage.vue";
import NowPlayingPage from "@/features/playback/pages/NowPlayingPage.vue";
import PlaybackBar from "@/features/playback/controls/PlaybackBar.vue";
import NotificationHost from "@/shared/notifications/NotificationHost.vue";
import LyricsDownloadDialog from "@/features/lyrics/download/LyricsDownloadDialog.vue";
import TagEditorDialog from "@/features/metadata/manual/components/TagEditorDialog.vue";
import ReleaseTagDialog from "@/features/metadata/releases/components/ReleaseTagDialog.vue";
import AppShell from "@/app/shell/AppShell.vue";
import QueuePanel from "@/features/playback/queue/components/QueuePanel.vue";
import TrackInfoPanel from "@/features/playback/current/TrackInfoPanel.vue";
import TitleBar from "@/app/shell/TitleBar.vue";

useShortcuts();
const { activePage } = usePersistentActivePage();
const { label: dropLabel } = useDropImport(activePage);
const playlistCatalog = shallowRef<PlaylistCatalog | null>(null);
</script>

<template>
  <div class="bg-app-base min-h-screen font-sans text-white">
    <TitleBar v-model:active-page="activePage" />
    <main class="grid min-h-screen place-items-center pt-14 pb-20 sm:pb-10">
      <AppShell :mode="activePage === 'Playing' ? 'playing' : 'workspace'">
        <template #workspace>
          <PlaylistPage
            :active="activePage === 'Playlist'"
            @catalog-ready="playlistCatalog = $event"
          />
          <LibraryPage :active="activePage === 'Library'" :catalog="playlistCatalog" />
          <InboxPage :active="activePage === 'Inbox'" />
        </template>
        <template #playing>
          <NowPlayingPage v-if="activePage === 'Playing'" />
        </template>
        <template #queue><QueuePanel /></template>
        <template #details><TrackInfoPanel /></template>
      </AppShell>
    </main>
    <PlaybackBar />
    <TagEditorDialog />
    <LyricsDownloadDialog />
    <ReleaseTagDialog />
    <NotificationHost />
    <div
      v-if="dropLabel"
      data-drop-import
      role="status"
      class="border-app-accent bg-app-base/80 pointer-events-none fixed inset-2 z-90 grid place-items-center rounded-xl border-2 text-xl font-semibold"
    >
      {{ dropLabel }}
    </div>
  </div>
</template>
