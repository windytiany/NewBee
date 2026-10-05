import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import type { LibraryState } from "@/features/library/composables/useLibrary";
import { notifications, notify } from "@/shared/notifications/center";
import { useNotification } from "@/shared/notifications/useNotification";
import { loadLibraryModules } from "./pageModules";

type TrackRemovalResult = Awaited<ReturnType<LibraryState["page"]["removeTrackFromLibrary"]>>;
const track = { id: 41, title: "Song", artist: "Artist", album: "Album", durationMs: 100 };
const album = { albumArtist: "Artist", album: "Album" };
const scopes: Vue.EffectScope[] = [];
let refreshCalls: number;
let closeCalls: number;
let showCalls: number;
let successfulTrackIds: number[];
let trackRemoval: TrackRemovalResult;
let albumRemoval: { completed: boolean; deletedCount: number; message: string };

const page = {
  tracks: Vue.ref([track]),
  artistsError: Vue.ref(""),
  albumsError: Vue.ref(""),
  tracksError: Vue.ref(""),
  isTrackActionPending: Vue.ref(false),
  trackActionError: Vue.ref(""),
  trackActionMessage: Vue.ref(""),
  trackActionMessageType: Vue.ref<"success" | "warning">("success"),
  addTracksToPlaylist: async () => ({ successfulTrackIds, failures: [] }),
  addAlbumToPlaylist: async () => ({ successfulTrackIds }),
  removeTrackFromLibrary: async () => trackRemoval,
  removeAlbumFromLibrary: async () => albumRemoval,
};
const modules: Record<string, unknown> = {
  vue: Vue,
  "@/features/library/composables/useBrowser": { useLibraryBrowser: () => page },
  "@/shared/notifications/center": { notify },
  "@/shared/notifications/useNotification": { useNotification },
};
const passiveComponent = { __esModule: true, default: Vue.defineComponent(() => () => null) };
for (const path of [
  "features/library/components/albums/AlbumBrowser.vue",
  "features/library/components/artists/ArtistList.vue",
  "shared/components/SidePane.vue",
  "features/library/components/dialogs/DeleteAlbumDialog.vue",
  "features/library/components/dialogs/DeleteTrackDialog.vue",
]) {
  modules[`@/${path}`] = passiveComponent;
}
await loadLibraryModules(modules);
const { useLibrary } = modules[
  "@/features/library/composables/useLibrary"
] as typeof import("@/features/library/composables/useLibrary");

function createWorkspace() {
  const active = Vue.ref(true);
  const scope = Vue.effectScope();
  scopes.push(scope);
  const workspace = scope.run(() =>
    useLibrary(active, {
      playlists: Vue.reactive({ playlists: [], isLoadingPlaylists: false, playlistsError: "" }),
      refreshPlaylists: async () => {
        refreshCalls += 1;
      },
    }),
  );
  if (!workspace) throw new Error("Workspace was not created.");
  const dialog = {
    show: () => {
      showCalls += 1;
    },
    close: () => {
      closeCalls += 1;
    },
  };
  workspace.elements.deleteTrackDialog.value = dialog;
  workspace.elements.deleteAlbumDialog.value = dialog;
  return { workspace, active };
}

beforeEach(() => {
  notifications.clear();
  refreshCalls = 0;
  closeCalls = 0;
  showCalls = 0;
  successfulTrackIds = [];
  trackRemoval = { status: "deleted" };
  albumRemoval = { completed: true, deletedCount: 1, message: "" };
  page.isTrackActionPending.value = false;
  page.artistsError.value = "";
  page.albumsError.value = "";
  page.tracksError.value = "";
  page.trackActionError.value = "";
  page.trackActionMessage.value = "";
  page.trackActionMessageType.value = "success";
});

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  notifications.clear();
});

describe("媒体库 workspace", () => {
  it("refreshes the playlist catalog only after tracks or albums were actually added", async () => {
    const { workspace } = createWorkspace();
    await workspace.addTracksToExistingPlaylist([track.id], 7);
    await workspace.addAlbumToExistingPlaylist(album, 7);
    expect(refreshCalls).toBe(0);
    successfulTrackIds = [track.id];
    await workspace.addTracksToExistingPlaylist([track.id], 7);
    await workspace.addAlbumToExistingPlaylist(album, 7);
    expect(refreshCalls).toBe(2);
  });

  it("keeps the track confirmation when deletion did not happen", async () => {
    trackRemoval = { status: "not-deleted", message: "Database unavailable" };
    const { workspace } = createWorkspace();
    workspace.requestTrackDeletion(track.id);
    await Vue.nextTick();
    await workspace.confirmTrackDeletion(track.id);
    expect(showCalls).toBe(1);
    expect(workspace.deleteTrackTarget?.id).toBe(track.id);
    expect(closeCalls).toBe(0);
    expect(refreshCalls).toBe(0);
  });

  it("closes after deletion even when queue synchronization failed without duplicating refresh", async () => {
    trackRemoval = {
      status: "deleted-queue-sync-failed",
      issue: "stop-failed",
      message: "Device busy",
    };
    const { workspace } = createWorkspace();
    workspace.requestTrackDeletion(track.id);
    await Vue.nextTick();
    await workspace.confirmTrackDeletion(track.id);
    expect(workspace.deleteTrackTarget).toBeNull();
    expect(closeCalls).toBe(1);
    expect(refreshCalls).toBe(0);
  });

  it("retains a partially deleted album confirmation without duplicating refresh", async () => {
    albumRemoval = { completed: false, deletedCount: 1, message: "One track failed" };
    const { workspace } = createWorkspace();
    workspace.requestAlbumDeletion(album);
    await Vue.nextTick();
    await workspace.confirmAlbumDeletion(workspace.deleteAlbumTarget!);
    expect(workspace.deleteAlbumTarget).not.toBeNull();
    expect(closeCalls).toBe(0);
    expect(refreshCalls).toBe(0);
    albumRemoval = { completed: true, deletedCount: 1, message: "" };
    await workspace.confirmAlbumDeletion(workspace.deleteAlbumTarget!);
    expect(workspace.deleteAlbumTarget).toBeNull();
    expect(closeCalls).toBe(1);
    expect(refreshCalls).toBe(0);
  });

  it("keeps library confirmations when the page becomes inactive", async () => {
    const { workspace, active } = createWorkspace();
    workspace.requestTrackDeletion(track.id);
    await Vue.nextTick();
    active.value = false;
    await Vue.nextTick();
    expect(workspace.deleteTrackTarget?.id).toBe(track.id);
    expect(closeCalls).toBe(0);
  });
});
