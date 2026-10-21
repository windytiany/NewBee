import { describe, expect, it } from "bun:test";
import { ref } from "vue";
import { createLibraryHarness } from "../../support/library/browser";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";

const harness = await createLibraryHarness();

describe("album playback by selection", () => {
  it("loads the target album without requiring its detail to be selected", async () => {
    const page = harness.mountLibraryPage();
    await harness.settleRequests();
    harness.availableTracks = [harness.track, harness.secondTrack, harness.thirdTrack];
    const target = { albumArtist: "Other Artist", album: "Other Album" };
    expect(await page.playAlbumFromLibrary(target)).toBe(true);
    expect(harness.albumTrackRequests).toEqual([target]);
    expect(harness.albumPlaybackCalls).toEqual([
      { trackIds: [41, 42, 43], rowKey: null, preserveQueue: false },
    ]);
    expect(page.selectedAlbum.value).toBeNull();
    expect(page.tracks.value).toEqual([]);
  });

  it("does not start playback for an empty album or a failed track request", async () => {
    const page = harness.mountLibraryPage();
    await harness.settleRequests();
    harness.availableTracks = [];
    const target = { albumArtist: null, album: null };
    expect(await page.playAlbumFromLibrary(target)).toBe(false);
    harness.albumTracksError = new Error("Database unavailable");
    expect(await page.playAlbumFromLibrary(target)).toBe(false);
    expect(harness.albumPlaybackCalls).toEqual([]);
    expect(page.trackActionError.value).toBe("播放专辑失败");
    expect(page.isTrackActionPending.value).toBe(false);
  });
});

describe("current album playback controls", () => {
  it("toggles the current track without replacing the queue or loading the album again", async () => {
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);
    harness.mockedCurrentTrack.value = {
      trackId: harness.track.id,
      title: harness.track.title,
      artist: harness.track.artist,
    };
    const requestCount = harness.albumTrackRequests.length;
    expect(await page.toggleCurrentAlbumPlayback()).toBe(true);
    expect(harness.togglePlaybackCalls).toBe(1);
    expect(harness.albumPlaybackCalls).toEqual([]);
    expect(harness.albumTrackRequests).toHaveLength(requestCount);
  });

  it("always restarts the album even when its current track can be toggled", async () => {
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);
    harness.mockedCurrentTrack.value = {
      trackId: harness.track.id,
      title: harness.track.title,
      artist: harness.track.artist,
    };
    harness.availableTracks = [harness.track, harness.secondTrack];
    expect(await page.playAlbumFromLibrary({ albumArtist: "Artist", album: "Album" })).toBe(true);
    expect(harness.togglePlaybackCalls).toBe(0);
    expect(harness.albumPlaybackCalls).toEqual([
      { trackIds: [41, 42], rowKey: null, preserveQueue: false },
    ]);
  });

  it("does not toggle another album's track or act while loading or pending", async () => {
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);
    harness.mockedCurrentTrack.value = {
      trackId: 999,
      title: harness.track.title,
      artist: harness.track.artist,
    };
    expect(await page.toggleCurrentAlbumPlayback()).toBe(false);
    harness.mockedCurrentTrack.value = {
      trackId: harness.track.id,
      title: harness.track.title,
      artist: harness.track.artist,
    };
    page.isLoadingTracks.value = true;
    expect(await page.toggleCurrentAlbumPlayback()).toBe(false);
    page.isLoadingTracks.value = false;
    harness.mockedPlaybackCommandPending.value = true;
    expect(await page.toggleCurrentAlbumPlayback()).toBe(false);
    harness.mockedPlaybackCommandPending.value = false;
    page.isTrackActionPending.value = true;
    expect(await page.toggleCurrentAlbumPlayback()).toBe(false);
    expect(harness.togglePlaybackCalls).toBe(0);
    expect(harness.albumPlaybackCalls).toEqual([]);
  });
});

describe("library page switching", () => {
  it("loads once on first activation when initially hidden", async () => {
    const active = ref(false);
    const page = harness.mountLibraryPage(active);
    await harness.settleRequests();
    expect(harness.invokeCalls).toEqual([]);
    active.value = true;
    await harness.settleRequests();
    expect(page.artists.value).toEqual([harness.artist]);
    expect(harness.invokeCalls).toEqual(["list_artists"]);
    active.value = false;
    active.value = true;
    await harness.settleRequests();
    expect(harness.invokeCalls).toEqual(["list_artists"]);
  });

  it("retries interrupted loading and ignores results from before deactivation", async () => {
    const active = ref(true);
    const page = harness.mountLibraryPage(active);
    await harness.loadTrack(page);
    let resolveOld!: (tracks: typeof harness.availableTracks) => void;
    harness.albumTracksResponse = new Promise((resolve) => {
      resolveOld = resolve;
    });
    page.selectAlbum(harness.album);
    expect(page.isLoadingTracks.value).toBe(true);
    active.value = false;
    harness.albumTracksResponse = null;
    harness.availableTracks = [harness.secondTrack];
    active.value = true;
    await harness.settleRequests();
    expect(page.tracks.value).toEqual([harness.secondTrack]);
    resolveOld([harness.track]);
    await harness.settleRequests();
    expect(page.tracks.value).toEqual([harness.secondTrack]);
    expect(page.isLoadingTracks.value).toBe(false);
  });

  it("keeps loaded albums and tracks without queries or loading states on reactivation", async () => {
    const active = ref(true);
    const page = harness.mountLibraryPage(active);
    await harness.loadTrack(page);
    const artists = page.artists.value;
    const albums = page.albums.value;
    const tracks = page.tracks.value;
    harness.invokeCalls = [];

    for (let index = 0; index < 3; index += 1) {
      active.value = false;
      active.value = true;
      expect(page.isLoadingArtists.value).toBe(false);
      expect(page.isLoadingAlbums.value).toBe(false);
      expect(page.isLoadingTracks.value).toBe(false);
      await harness.settleRequests();
      expect(page.artists.value).toBe(artists);
      expect(page.albums.value).toBe(albums);
      expect(page.tracks.value).toBe(tracks);
    }
    expect(harness.invokeCalls).toEqual([]);
  });

  it("defers and coalesces library changes while hidden, then refreshes once", async () => {
    const active = ref(true);
    const page = harness.mountLibraryPage(active);
    await harness.loadTrack(page);
    active.value = false;
    harness.invokeCalls = [];
    harness.availableTracks = [harness.track, harness.secondTrack];
    globalThis.window.dispatchEvent(new Event("library-changed"));
    globalThis.window.dispatchEvent(new Event("library-changed"));
    await harness.settleRequests();
    expect(harness.invokeCalls).toEqual([]);
    active.value = true;
    await harness.settleRequests();
    expect(page.tracks.value).toEqual(harness.availableTracks);
    expect(harness.invokeCalls).toEqual(["list_artists", "list_albums", "list_album_tracks"]);
    harness.invokeCalls = [];
    active.value = false;
    active.value = true;
    await harness.settleRequests();
    expect(harness.invokeCalls).toEqual([]);
  });
});

describe("library album sorting updates", () => {
  it("refreshes albums after settings save without changing the expanded album", async () => {
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);
    const selection = page.selectedAlbum.value;
    if (!selection) throw new Error("Album selection was not initialized.");
    harness.availableAlbums = [
      { albumArtist: "Artist", album: "New album", year: 2025 },
      harness.album,
    ];
    globalThis.window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
    await harness.settleRequests();
    expect(page.albums.value).toEqual(harness.availableAlbums);
    expect(page.selectedAlbum.value).toEqual(selection);
    expect(page.tracks.value).toEqual(harness.availableTracks);
    expect(harness.invokeCalls.filter((command) => command === "list_albums")).toHaveLength(2);
  });

  it("uses the latest ordering when reactivated and stops listening when unmounted", async () => {
    const active = ref(true);
    const page = harness.mountLibraryPage(active);
    await harness.loadTrack(page);
    active.value = false;
    harness.availableAlbums = [
      { albumArtist: "Artist", album: "New album", year: 2025 },
      harness.album,
    ];
    const beforeUpdate = harness.invokeCalls.length;
    globalThis.window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
    await harness.settleRequests();
    expect(harness.invokeCalls).toHaveLength(beforeUpdate);
    active.value = true;
    await harness.settleRequests();
    expect(page.albums.value).toEqual(harness.availableAlbums);
    for (const app of harness.mountedApps.splice(0)) app.unmount();
    const beforeUnmount = harness.invokeCalls.length;
    globalThis.window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
    await harness.settleRequests();
    expect(harness.invokeCalls).toHaveLength(beforeUnmount);
  });
});

describe("library album actions", () => {
  const selection = { albumArtist: "Other artist", album: "Other album" };

  it("loads the target album without expanding it and queues all tracks in order", async () => {
    harness.availableTracks = [harness.track, harness.secondTrack, harness.thirdTrack];
    const page = harness.mountLibraryPage();
    await harness.settleRequests();

    expect(await page.addAlbumToNext(selection)).toBe(true);
    expect(await page.addAlbumToQueueEnd(selection)).toBe(true);
    expect(harness.albumTrackRequests).toEqual([selection, selection]);
    expect(harness.queueNextBatchCalls).toEqual([
      [harness.track.id, harness.secondTrack.id, harness.thirdTrack.id],
    ]);
    expect(harness.queueEndBatchCalls).toEqual([
      [harness.track.id, harness.secondTrack.id, harness.thirdTrack.id],
    ]);
    expect(page.selectedAlbum.value).toBeNull();
    expect(page.tracks.value).toEqual([]);
  });

  it("adds the whole album to a playlist and continues after an item fails", async () => {
    harness.availableTracks = [harness.track, harness.secondTrack, harness.thirdTrack];
    harness.playlistAddFailures.set(harness.secondTrack.id, new Error("permission denied"));
    const page = harness.mountLibraryPage();
    await harness.settleRequests();

    const result = await page.addAlbumToPlaylist(selection, 3);

    expect(result.successfulTrackIds).toEqual([harness.track.id, harness.thirdTrack.id]);
    expect(harness.playlistAddCalls).toEqual([
      harness.track.id,
      harness.secondTrack.id,
      harness.thirdTrack.id,
    ]);
    expect(page.trackActionMessage.value).toContain("1 首失败");
    expect(page.isTrackActionPending.value).toBe(false);
  });
});

describe("library track actions", () => {
  it("submits a visible-order batch as one queue addition", async () => {
    harness.availableTracks = [harness.track, harness.secondTrack];
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);

    expect(await page.addTracksToNext([harness.secondTrack.id, harness.track.id])).toBe(true);
    expect(harness.queueNextBatchCalls).toEqual([[harness.secondTrack.id, harness.track.id]]);
  });

  it("continues playlist additions after failures and reports every failed item", async () => {
    harness.availableTracks = [harness.track, harness.secondTrack, harness.thirdTrack];
    harness.playlistAddFailures.set(harness.secondTrack.id, new Error("permission denied"));
    const page = harness.mountLibraryPage();
    await harness.loadTrack(page);

    const result = await page.addTracksToPlaylist(
      [harness.track.id, harness.secondTrack.id, harness.thirdTrack.id],
      3,
    );

    expect(harness.playlistAddCalls).toEqual([
      harness.track.id,
      harness.secondTrack.id,
      harness.thirdTrack.id,
    ]);
    expect(result).toEqual({
      successfulTrackIds: [harness.track.id, harness.thirdTrack.id],
      failures: [
        {
          trackId: harness.secondTrack.id,
          trackName: harness.secondTrack.title,
          message: "permission denied",
        },
      ],
    });
    expect(page.trackActionMessage.value).toBe("已添加 2 首，1 首失败");
  });
});
