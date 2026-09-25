<template>
  <ResizableThreeColumnLayout>
    <template #left>
      <PlaylistList
        :playlists="placeholderPlaylists"
        :selected-playlist-id="selectedPlaylistId"
        @select="selectPlaylist"
      />
    </template>

    <template #center>
      <PlaylistBrowser :playlist="selectedPlaylist" />
    </template>

    <template #right-top>
      <TrackList />
    </template>

    <template #right-bottom>
      <TrackInfo />
    </template>
  </ResizableThreeColumnLayout>
</template>

<script setup lang="ts">
import type { Playlist } from "../types/playlist";
import { usePersistentPlaylistSelection } from "../composables/usePersistentPlaylistSelection";
import PlaylistBrowser from "../components/playlist/PlaylistBrowser.vue";
import PlaylistList from "../components/playlist/PlaylistList.vue";
import ResizableThreeColumnLayout from "../components/layout/ResizableThreeColumnLayout.vue";
import TrackInfo from "../components/track/TrackInfo.vue";
import TrackList from "../components/track/TrackList.vue";

const placeholderPlaylists: Playlist[] = [
  {
    id: "study-with-miku",
    name: "Study With Miku",
    tracks: [
      {
        id: "track-1",
        title: "Stargazer",
        artist: "DECO*27",
        album: "Study With Miku",
        duration: "3:18",
      },
      {
        id: "track-2",
        title: "Re:Re:",
        artist: "じん",
        album: "Study With Miku",
        duration: "4:43",
      },
      {
        id: "track-3",
        title: "Moonlight",
        artist: "Mitchie M",
        album: "Study With Miku",
        duration: "4:57",
      },
      {
        id: "track-4",
        title: "夜に駆ける",
        artist: "Ayase",
        album: "Study With Miku",
        duration: "3:57",
      },
      {
        id: "track-5",
        title: "さよならメモリーズ",
        artist: "supercell",
        album: "Study With Miku",
        duration: "4:39",
      },
      {
        id: "track-6",
        title: "Glow",
        artist: "keeno",
        album: "Study With Miku",
        duration: "5:15",
      },
      {
        id: "track-7",
        title: "from Y to Y",
        artist: "ジミーサムP",
        album: "Study With Miku",
        duration: "5:29",
      },
      {
        id: "track-8",
        title: "Deep Blue",
        artist: "八王子P",
        album: "Study With Miku",
        duration: "4:46",
      },
      {
        id: "track-9",
        title: "Tell Your World",
        artist: "kz",
        album: "Study With Miku",
        duration: "3:16",
      },
      {
        id: "track-10",
        title: "Last Night, Good Night",
        artist: "livetune",
        album: "Study With Miku",
        duration: "6:10",
      },
    ],
  },
];

const { selectedPlaylistId, selectedPlaylist, selectPlaylist } =
  usePersistentPlaylistSelection(placeholderPlaylists);
</script>
