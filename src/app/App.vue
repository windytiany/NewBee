<script setup lang="ts">
import { shallowRef } from "vue";
import { usePageFocus } from "@/app/usePageFocus";
import { useStartupUpdates } from "@/app/update";
import CommandDialog from "@/features/shortcuts/CommandDialog.vue";
import { getContextCommands } from "@/features/shortcuts/context";
import { useTrackBridge } from "@/features/tracks/bridge";
import { usePlaybackLyrics } from "@/features/lyrics/useSidecar";
import { useDropImport } from "@/app/import/useDropImport";
import { usePersistentActivePage } from "@/app/pages";
import { useShortcuts } from "@/features/shortcuts/useShortcuts";
import type { PlaylistCatalog } from "@/features/playlist/types";
import LibraryPage from "@/features/library/LibraryPage.vue";
import PlaylistPage from "@/features/playlist/PlaylistPage.vue";
import InboxPage from "@/features/inbox/InboxPage.vue";
import NowPlayingPage from "@/features/playback/NowPlayingPage.vue";
import PlaybackBar from "@/features/playback/controls/PlaybackBar.vue";
import NotificationHost from "@/shared/notifications/NotificationHost.vue";
import MissingFilesDialog from "@/features/library/synchronization/MissingFilesDialog.vue";
import LyricsDownloadDialog from "@/features/lyrics/download/LyricsDownloadDialog.vue";
import ReplayGainConfirmationDialog from "@/features/metadata/replaygain/ConfirmationDialog.vue";
import TagEditorDialog from "@/features/metadata/manual/TagEditorDialog.vue";
import ReleaseTagDialog from "@/features/metadata/releases/ReleaseTagDialog.vue";
import AppShell from "@/app/shell/AppShell.vue";
import QueuePanel from "@/features/playback/queue/QueuePanel.vue";
import TrackInfoPanel from "@/features/playback/current/TrackInfoPanel.vue";
import TitleBar from "@/app/shell/TitleBar.vue";

useTrackBridge();
usePlaybackLyrics();
const { activePage } = usePersistentActivePage();
const titleBar = shallowRef<InstanceType<typeof TitleBar> | null>(null);
useStartupUpdates(() => void titleBar.value?.showSettings("advanced"));
const commandDialog = shallowRef<InstanceType<typeof CommandDialog> | null>(null);
usePageFocus();
const { bindings, run } = useShortcuts(
  (page) => {
    activePage.value = page;
  },
  {
    showSettings: () => titleBar.value?.showSettings(),
    showCommands: () => commandDialog.value?.show("commands"),
    showShortcuts: () => commandDialog.value?.show("shortcuts"),
    addToQueue: () => getContextCommands(globalThis.document.activeElement).addToQueue?.(),
  },
);
const { highlight: dropHighlight } = useDropImport();
const playlistCatalog = shallowRef<PlaylistCatalog | null>(null);
</script>

<template>
  <div class="bg-app-base min-h-screen font-sans text-white">
    <TitleBar
      ref="titleBar"
      v-model:active-page="activePage"
      :bindings="bindings"
      @commands="commandDialog?.show('commands')"
      @shortcuts="commandDialog?.show('shortcuts')"
    />
    <CommandDialog ref="commandDialog" :bindings="bindings" :run="run" />
    <main class="grid min-h-screen place-items-center pt-14 pb-20 sm:pb-10">
      <AppShell :mode="activePage === 'Playing' ? 'playing' : 'workspace'">
        <template #workspace>
          <div data-page="Playlist" class="contents">
            <PlaylistPage
              :active="activePage === 'Playlist'"
              @catalog-ready="playlistCatalog = $event"
            />
          </div>
          <div data-page="Library" class="contents">
            <LibraryPage :active="activePage === 'Library'" :catalog="playlistCatalog" />
          </div>
          <div data-page="Inbox" class="contents">
            <InboxPage :active="activePage === 'Inbox'" />
          </div>
        </template>
        <template #playing>
          <div v-if="activePage === 'Playing'" data-page="Playing" class="contents">
            <NowPlayingPage />
          </div>
        </template>
        <template #queue><QueuePanel /></template>
        <template #details><TrackInfoPanel /></template>
      </AppShell>
    </main>
    <PlaybackBar />
    <TagEditorDialog />
    <LyricsDownloadDialog />
    <ReplayGainConfirmationDialog />
    <ReleaseTagDialog />
    <NotificationHost />
    <MissingFilesDialog />
    <div
      v-if="dropHighlight"
      data-drop-import
      aria-hidden="true"
      :style="dropHighlight"
      class="border-app-accent pointer-events-none fixed z-90 border-2"
    ></div>
  </div>
</template>
