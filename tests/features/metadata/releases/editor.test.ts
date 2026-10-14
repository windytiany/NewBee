import { describe, expect, it } from "bun:test";
import { createReleaseEditor } from "@/features/metadata/releases/useEditor";
import type { ReleaseEditorOptions } from "@/features/metadata/releases/useEditor";
import type { MetadataSaveResult } from "@/features/metadata/types";
import type { CoverData, TrackPatch } from "@/features/metadata/releases/types";
import { album, local, release } from "./fixtures";
const settle = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const result = (trackId: number, success = true): MetadataSaveResult => ({
  trackId,
  path: `/music/${trackId}.flac`,
  fileWritten: success,
  databaseUpdated: success,
  error: success ? null : "只读",
});
function fixture(overrides: Partial<ReleaseEditorOptions> = {}) {
  const saves: TrackPatch[][] = [];
  const searches: Array<{ artist: string; album: string; offset: number }> = [];
  const synchronized: number[][] = [];
  const editor = createReleaseEditor({
    loadTracks: async (ids) => ids.map((id) => local(id)),
    loadAlbum: async () => [local(1), local(2)],
    search: async (artist, album, offset) => {
      searches.push({ artist, album, offset });
      return { count: 60, offset, releases: [release(String(offset)).summary] };
    },
    release: async (id) => release(id),
    covers: async () => [],
    cover: async () => ({ mimeType: "image/png", data: [1, 2, 3] }),
    save: async (patches, _cover, progress) => {
      saves.push(patches);
      const results = patches.map((patch) => result(patch.trackId));
      results.forEach(progress);
      return results;
    },
    synchronize: async (ids) => {
      synchronized.push(ids);
    },
    editFiles: (_ids, save) => save(),
    ...overrides,
  });
  return { editor, saves, searches, synchronized };
}
async function ready(overrides: Partial<ReleaseEditorOptions> = {}) {
  const context = fixture(overrides);
  await context.editor.open(album);
  context.editor.selectRelease(release().summary.id);
  await settle();
  return context;
}

describe("album tag editing", () => {
  it("prefills but never searches or saves without an explicit action", async () => {
    const { editor, searches, saves } = fixture();
    await editor.open(album);
    expect(editor.state.artist).toBe("Artist");
    expect(editor.state.album).toBe("Album");
    expect(searches).toEqual([]);
    expect(saves).toEqual([]);
    await editor.search();
    editor.state.album = "changed";
    await editor.loadMore();
    expect(searches).toEqual([
      { artist: "Artist", album: "Album", offset: 0 },
      { artist: "Artist", album: "Album", offset: 25 },
    ]);
  });
  it("defaults to all mapped files and available fields, but not cover writes", async () => {
    const { editor } = await ready();
    expect(editor.state.rows.map((row) => row.trackId)).toEqual([1, 2, null, null]);
    expect(editor.state.included).toEqual([1, 2]);
    expect(editor.state.fields).toContain("title");
    expect(editor.state.writeCover).toBe(false);
    expect(editor.state.dirty).toBe(false);
  });
  it("preserves local tracks with a blank source through shared edits and cover saving", async () => {
    const { editor, saves } = await ready({
      loadTracks: async (ids) => ids.map((id) => local(id)),
      loadAlbum: async () => [local(1), local(2), local(3), local(4), local(5)],
      covers: async () => [{ id: "cover", comment: "" }],
    });
    editor.move(1, null);
    editor.setSharedValue("album", "Updated album");
    const detached = editor.state.rows.filter((row) => row.source === null);
    expect(detached.map((row) => row.trackId)).toEqual([1, 5]);
    expect(detached.every((row) => row.values.album === undefined)).toBe(true);
    editor.toggleCover();
    editor.prepareSave();
    expect(editor.state.patches.map((patch) => patch.trackId)).toEqual([2, 3, 4]);
    expect(editor.state.patches.every((patch) => patch.writeCover)).toBe(true);
    await editor.save();
    expect(saves[0]?.map((patch) => patch.trackId)).toEqual([2, 3, 4]);
    expect(editor.state.tracks.find(({ track }) => track.id === 1)?.track.album).toBe("Album");
    expect(editor.state.tracks.find(({ track }) => track.id === 5)?.track.album).toBe("Album");
  });
  it("requires confirmation and saves immutable per-track patches", async () => {
    const { editor, saves, synchronized } = await ready();
    editor.setValue(0, "title", "修订标题");
    editor.prepareSave();
    expect(editor.state.confirmSave).toBe(true);
    expect(saves).toEqual([]);
    editor.setValue(0, "title", "blocked");
    editor.move(1, 2);
    expect(editor.state.rows[0]?.values.title).toBe("修订标题");
    await editor.save();
    expect(saves[0]?.[0]?.changes).toContainEqual({ field: "title", value: "修订标题" });
    expect(synchronized).toEqual([[1, 2]]);
    expect(editor.state.open).toBe(false);
  });
  it("can cancel at the save confirmation and while loading local tracks", async () => {
    const { editor, saves } = await ready();
    editor.prepareSave();
    editor.requestClose();
    expect(editor.state.open).toBe(false);
    expect(saves).toEqual([]);
    const pending = deferred<ReturnType<typeof local>[]>();
    const context = fixture({ loadAlbum: () => pending.promise });
    const opening = context.editor.open(album);
    context.editor.requestClose();
    expect(context.editor.state.open).toBe(false);
    pending.resolve([local(1)]);
    await opening;
    expect(context.editor.state.tracks).toEqual([]);
  });
  it("prompts before discarding mappings on version change or close", async () => {
    const { editor } = await ready();
    editor.move(1, 2);
    editor.selectRelease("another");
    expect(editor.state.confirmDiscard).toBe(true);
    expect(editor.state.selected?.summary.id).not.toBe("another");
    editor.confirmDiscard();
    await settle();
    expect(editor.state.selected?.summary.id).toBe("another");
    expect(editor.state.dirty).toBe(false);
    editor.toggleTrack(1);
    editor.requestClose();
    expect(editor.state.open).toBe(true);
    editor.confirmDiscard();
    expect(editor.state.open).toBe(false);
  });
  it("ignores stale release and search responses after closing and reopening", async () => {
    const pendingRelease = deferred<ReturnType<typeof release>>();
    const pendingSearch = deferred<{ count: number; offset: number; releases: [] }>();
    const { editor } = fixture({
      release: () => pendingRelease.promise,
      search: () => pendingSearch.promise,
    });
    await editor.open(album);
    editor.selectRelease("old");
    void editor.search();
    editor.requestClose();
    await editor.open({ albumArtist: "New", album: "New" });
    pendingRelease.resolve(release("old"));
    pendingSearch.resolve({ count: 0, offset: 0, releases: [] });
    await settle();
    expect(editor.state.selected).toBeNull();
    expect(editor.state.artist).toBe("New");
    expect(editor.state.loadingRelease).toBe(false);
    expect(editor.state.searching).toBe(false);
  });
  it("downloads covers independently and permits tags when cover retrieval fails", async () => {
    const { editor, saves } = await ready({
      covers: async () => {
        throw new Error("network");
      },
    });
    expect(editor.state.coverError).toContain("network");
    editor.prepareSave();
    await editor.save();
    expect(saves[0]?.every((patch) => !patch.writeCover)).toBe(true);
  });
  it("discards obsolete cover responses when selecting another cover", async () => {
    const first = deferred<CoverData>();
    const { editor } = await ready({
      covers: async () => [
        { id: "1", comment: "" },
        { id: "2", comment: "" },
      ],
      cover: async (_release, id) =>
        id === "1" ? first.promise : { mimeType: "image/png", data: [2] },
    });
    await editor.selectCover("2");
    first.resolve({ mimeType: "image/png", data: [1] });
    await settle();
    expect(editor.state.cover?.data).toEqual([2]);
  });
  it("retains each outcome and the patch snapshot after partial failure", async () => {
    const calls: TrackPatch[][] = [];
    const { editor, synchronized } = await ready({
      save: async (patches, _cover, progress) => {
        calls.push(patches);
        const results = patches.map((patch) =>
          result(patch.trackId, calls.length > 1 || patch.trackId === 1),
        );
        results.forEach(progress);
        return results;
      },
    });
    editor.prepareSave();
    await editor.save();
    expect(editor.state.open).toBe(true);
    expect(editor.state.results.length).toBe(2);
    expect(calls).toHaveLength(1);
    expect(editor.state.patches.map((patch) => patch.trackId)).toEqual([1, 2]);
    expect(editor.state.results.map(({ databaseUpdated }) => databaseUpdated)).toEqual([
      true,
      false,
    ]);
    expect(synchronized).toEqual([[1]]);
    expect("retryFailed" in editor).toBe(false);
    editor.prepareSave();
    await editor.save();
    expect(calls.map((patches) => patches.map(({ trackId }) => trackId))).toEqual([[1, 2], [2]]);
    expect(editor.state.results.map(({ databaseUpdated }) => databaseUpdated)).toEqual([
      true,
      true,
    ]);
    expect(editor.state.open).toBe(false);
  });
  it("retains saved results after synchronization failure without a retry entry", async () => {
    let attempts = 0;
    const { editor, saves } = await ready({
      synchronize: async () => {
        attempts++;
        if (attempts === 1) throw new Error("reload failed");
      },
    });
    editor.prepareSave();
    await editor.save();
    expect(editor.state.open).toBe(true);
    expect(editor.state.dirty).toBe(false);
    expect(editor.state.results.every(({ databaseUpdated }) => databaseUpdated)).toBe(true);
    expect(editor.state.synchronizationError).toContain("reload failed");
    expect("retrySynchronization" in editor).toBe(false);
    expect(attempts).toBe(1);
    expect(saves).toHaveLength(1);
    editor.prepareSave();
    await editor.save();
    expect(attempts).toBe(2);
    expect(saves).toHaveLength(1);
    expect(editor.state.results.every(({ databaseUpdated }) => databaseUpdated)).toBe(true);
    expect(editor.state.open).toBe(false);
  });
  it("closes on confirmation and prevents reopening or saving twice during a write", async () => {
    const pending = deferred<MetadataSaveResult[]>();
    const { editor } = await ready({ save: () => pending.promise });
    editor.prepareSave();
    const saving = editor.save();
    editor.requestClose();
    editor.close();
    await editor.open(album);
    await editor.save();
    expect(editor.state.open).toBe(false);
    expect(editor.state.confirmSave).toBe(false);
    expect(editor.state.confirmDiscard).toBe(false);
    expect(editor.state.saving).toBe(true);
    pending.resolve([result(1), result(2)]);
    await saving;
    expect(editor.state.open).toBe(false);
  });
});

it("loads numeric release targets from snapshots, deduplicates IDs and rejects incomplete selections", async () => {
  const loads: number[][] = [];
  const { editor } = fixture({
    loadTracks: async (ids) => {
      loads.push(ids);
      return ids.map((id) => local(id));
    },
  });
  await editor.openTracks([1, 2, 1]);
  expect(loads).toEqual([[1, 2]]);
  expect(editor.state.tracks.map(({ track }) => track.id)).toEqual([1, 2]);
  expect(editor.state.artist).toBe(local(1).track.albumArtist ?? local(1).track.artist ?? "");
  const missing = fixture({ loadTracks: async () => [local(1)] }).editor;
  await missing.openTracks([1, 2]);
  expect(missing.state.error).toContain("不匹配");
  expect(missing.state.tracks).toEqual([]);
});

it("retains file success and DB failure, accepting only confirmed local patches and retrying the failed ID", async () => {
  let attempt = 0;
  const writes: number[][] = [];
  const { editor, synchronized } = await ready({
    save: async (patches) => {
      writes.push(patches.map(({ trackId }) => trackId));
      attempt++;
      return patches.map(({ trackId }) =>
        attempt === 1 && trackId === 2
          ? { ...result(trackId), databaseUpdated: false, error: "database failed" }
          : result(trackId),
      );
    },
  });
  const original = editor.state.tracks.find(({ track }) => track.id === 2)?.track.title;
  editor.prepareSave();
  await editor.save();
  expect(
    editor.state.results.map(({ fileWritten, databaseUpdated }) => [fileWritten, databaseUpdated]),
  ).toEqual([
    [true, true],
    [true, false],
  ]);
  expect(editor.state.tracks.find(({ track }) => track.id === 2)?.track.title).toBe(original);
  expect(editor.state.dirty).toBe(true);
  expect(synchronized).toEqual([[1]]);
  editor.prepareSave();
  await editor.save();
  expect(writes).toEqual([[1, 2], [2]]);
  expect(editor.state.results.map(({ databaseUpdated }) => databaseUpdated)).toEqual([true, true]);
  expect(editor.state.open).toBe(false);
});
