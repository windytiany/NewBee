import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { setLocale } from "@/shared/i18n/locale";
import type { LibraryState } from "@/features/library/composables/useLibrary";
import { notifications, notify } from "@/shared/notifications/center";
import { useNotification } from "@/shared/notifications/useNotification";
import { loadLibraryModules } from "./modules";

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
  trackActionRemoval: Vue.ref<{
    deletedCount: number;
    failedCount: number;
    queueSyncFailed: boolean;
  } | null>(null),
  trackActionMessageType: Vue.ref<"success" | "warning">("success"),
  addTracksToPlaylist: async () => ({ successfulTrackIds, failures: [] }),
  addAlbumToPlaylist: async () => ({ successfulTrackIds }),
  removeTrackFromLibrary: async () => trackRemoval,
  removeAlbumFromLibrary: async () => albumRemoval,
};
const modules: Record<string, unknown> = {
  vue: Vue,
  "@/features/library/browser/useBrowser": { useLibraryBrowser: () => page },
  "@/shared/notifications/center": { notify },
  "@/shared/notifications/useNotification": { useNotification },
};
const passiveComponent = { __esModule: true, default: Vue.defineComponent(() => () => null) };
for (const path of [
  "features/library/browser/albums/AlbumBrowser.vue",
  "features/artists/navigation/ArtistList.vue",
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
  page.trackActionRemoval.value = null;
  page.trackActionMessageType.value = "success";
});

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  setLocale("zh-CN");
  notifications.clear();
});

describe("媒体库 workspace", () => {
  for (const [failedCount, queueSyncFailed, expected] of [
    [1, false, "Removed 2 tracks; 1 removals failed. Check the logs."],
    [0, true, "Removed 2 tracks, but queue synchronization failed. Check the logs."],
    [
      1,
      true,
      "Removed 2 tracks; 1 removals failed and queue synchronization failed. Check the logs.",
    ],
  ] as const) {
    it(`localizes partial removal counts with ${failedCount} failures and queue sync ${queueSyncFailed}`, async () => {
      setLocale("en");
      createWorkspace();
      page.trackActionRemoval.value = { deletedCount: 2, failedCount, queueSyncFailed };
      page.trackActionError.value = "原始底层错误";
      await Vue.nextTick();
      expect(notifications.items.value[0]).toMatchObject({
        message: expected,
        type: "warning",
        persistent: true,
      });
      expect(page.trackActionError.value).toBe("原始底层错误");
    });
  }

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

  it("does not infer removal or persistence from error text or playlist partial success", async () => {
    createWorkspace();
    page.trackActionMessage.value = "已添加 2 首，1 首失败（详情见日志）";
    page.trackActionMessageType.value = "warning";
    await Vue.nextTick();
    expect(notifications.items.value[0]?.message).toContain("已添加 2 首");
    expect(notifications.items.value[0]?.persistent).toBe(false);
    notifications.clear();
    page.trackActionError.value = "已删除是底层错误中的文本";
    await Vue.nextTick();
    expect(notifications.items.value[0]?.message).toBe("已添加 2 首，1 首失败（详情见日志）");
    expect(notifications.items.value[0]?.message).not.toContain("已从曲库移除");
    expect(notifications.items.value[0]?.persistent).toBe(false);
  });

  it("uses explicit zero, partial and queue-sync removal outcomes for notification lifetime", async () => {
    createWorkspace();
    page.trackActionRemoval.value = { deletedCount: 0, failedCount: 2, queueSyncFailed: false };
    page.trackActionMessage.value = "已从曲库删除 0 首曲目。";
    page.trackActionError.value = "移除失败";
    await Vue.nextTick();
    expect(notifications.items.value[0]?.message).toBe("曲库移除失败，请重试或查看日志");
    expect(notifications.items.value[0]?.persistent).toBe(false);
    page.trackActionRemoval.value = { deletedCount: 1, failedCount: 1, queueSyncFailed: false };
    await Vue.nextTick();
    expect(notifications.items.value[0]?.message).toBe(
      "已从曲库移除 1 首，1 首移除失败，请查看日志",
    );
    expect(notifications.items.value[0]?.persistent).toBe(true);
    page.trackActionMessage.value = "";
    page.trackActionRemoval.value = { deletedCount: 1, failedCount: 0, queueSyncFailed: true };
    await Vue.nextTick();
    expect(notifications.items.value[0]?.message).toBe(
      "已从曲库移除 1 首，队列同步失败，请查看日志",
    );
    expect(notifications.items.value[0]?.type).toBe("warning");
    expect(notifications.items.value[0]?.persistent).toBe(true);
  });

  it("notifies failures while confirmations remain open without repeating on close", async () => {
    const { workspace } = createWorkspace();
    workspace.requestAlbumDeletion(album);
    page.isTrackActionPending.value = true;
    page.trackActionRemoval.value = { deletedCount: 1, failedCount: 1, queueSyncFailed: false };
    page.trackActionMessage.value = "已从曲库移除 1 首";
    page.trackActionError.value = "移除失败";
    await Vue.nextTick();
    expect(notifications.items.value).toEqual([]);
    page.isTrackActionPending.value = false;
    await Vue.nextTick();
    expect(workspace.deleteAlbumTarget).not.toBeNull();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "warning",
      persistent: true,
      count: 1,
    });
    workspace.cancelAlbumDeletion();
    await Vue.nextTick();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.count).toBe(1);
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
