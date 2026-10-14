import type { ArtworkCollection, ArtworkDraft } from "@/features/artwork/collection/types";
import type { MetadataTarget } from "@/features/metadata/types";
import { describe, expect, it } from "bun:test";
import { createTagEditor } from "@/features/metadata/manual/useEditor";
import type { TagEditorOptions } from "@/features/metadata/manual/useEditor";
import { buildTagChanges, createTagDraft, TAG_FIELDS } from "@/features/metadata/draft";
import type { EditableTrack, TagChange, MetadataSaveResult } from "@/features/metadata/types";

function editable(id: MetadataTarget, title = `Track ${id}`): EditableTrack {
  return {
    track: {
      id,
      path: `/music/${id}.mp3`,
      title,
      artist: "Artist",
      album: "Album",
      albumArtist: "Album Artist",
      releaseDate: "2024-02-29",
      trackNumber: typeof id === "number" ? id : null,
      discNumber: 1,
      trackTotal: 7,
      discTotal: 2,
      durationMs: 1000,
      codec: "mp3",
      sampleRateHz: 44100,
      bitrateKbps: 128,
      channels: 2,
    },
    lyrics: "[00:01.00]Original lyrics\n[00:02.00]Second line",
    noLyrics: false,
    writableFields: [...TAG_FIELDS.map(({ key }) => key), "lyrics"],
    issue: null,
  };
}
function result(trackId: MetadataTarget, success = true): MetadataSaveResult {
  return {
    trackId,
    path: `/music/${trackId}.mp3`,
    fileWritten: success,
    databaseUpdated: success,
    error: success ? null : "文件只读",
  };
}
function fixture(overrides: Partial<TagEditorOptions> = {}) {
  const saves: Array<{ ids: MetadataTarget[]; changes: TagChange[] }> = [];
  const synchronized: MetadataTarget[][] = [];
  const editor = createTagEditor({
    loadTracks: async (ids) => ids.map((id) => editable(id)),
    loadCollections: async (ids) =>
      ids.map((trackId) => ({
        trackId,
        pictures: [],
        displayIndex: null,
        error: null,
      })),
    planArtwork: async (drafts) =>
      drafts.map(({ trackId }) => ({ trackId, fileWriteRequired: true, error: null })),
    readArtwork: async () => {
      throw new Error("No existing artwork in this fixture");
    },
    loadAlbum: async () => [1, 2],
    save: async (ids, changes, progress) => {
      saves.push({ ids, changes });
      const results = ids.map((id) => result(id));
      for (const entry of results) progress(entry);
      return results;
    },
    synchronize: async (ids) => {
      synchronized.push(ids);
    },
    editFiles: (_ids, save) => save(),
    ...overrides,
  });
  return { editor, saves, synchronized };
}
async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("metadata editing", () => {
  it("loads file-only fields from the editing snapshot and clears them explicitly", async () => {
    const { editor, saves } = fixture({
      loadTracks: async (ids) =>
        ids.map((id) => ({
          ...editable(id),
          values: {
            artistSort: "Artist, The",
            albumArtistSort: "Group, The",
            discSubtitle: "Bonus",
            label: "Label",
            originalReleaseDate: "1998-03",
          },
        })),
    });
    await editor.openTracks([1]);
    for (const key of [
      "artistSort",
      "albumArtistSort",
      "discSubtitle",
      "label",
      "originalReleaseDate",
    ]) {
      const field = editor.state.draft.find((field) => field.key === key);
      if (!field) throw new Error(`Missing ${key}`);
      expect(field.value).not.toBe("");
      editor.changeField(field, "");
    }
    editor.prepareSave();
    await settle();
    expect(saves[0]?.changes).toEqual([
      { field: "artistSort", value: null },
      { field: "albumArtistSort", value: null },
      { field: "discSubtitle", value: null },
      { field: "label", value: null },
      { field: "originalReleaseDate", value: null },
    ]);
    expect(editor.state.draft.some((field) => field.key.includes("musicBrainz"))).toBe(false);
  });

  it("loads raw single-track lyrics, preserves whitespace and saves only edited lyrics", async () => {
    const { editor, saves } = fixture();
    await editor.openTracks([1]);
    const lyrics = editor.state.draft.find(({ key }) => key === "lyrics");
    if (!lyrics) throw new Error("Missing lyrics");
    expect(lyrics.value).toBe("[00:01.00]Original lyrics\n[00:02.00]Second line");
    expect(buildTagChanges(editor.state.draft).some(({ field }) => field === "lyrics")).toBe(false);
    editor.changeField(lyrics, "  [00:01.00]Edited lyrics\n\n");
    expect(editor.state.dirty).toBe(true);
    editor.prepareSave();
    await settle();
    expect(saves[0]?.changes).toEqual([
      { field: "lyrics", value: "  [00:01.00]Edited lyrics\n\n" },
    ]);
  });

  it("can clear lyrics and never includes lyrics in batch or album drafts", async () => {
    const { editor, saves } = fixture();
    await editor.openTracks([1]);
    const lyrics = editor.state.draft.find(({ key }) => key === "lyrics");
    if (!lyrics) throw new Error("Missing lyrics");
    editor.changeField(lyrics, "");
    editor.prepareSave();
    await settle();
    expect(saves[0]?.changes.find(({ field }) => field === "lyrics")?.value).toBeNull();
    expect(
      createTagDraft([editable(1), editable(2)], "tracks").some(({ key }) => key === "lyrics"),
    ).toBe(false);
    expect(createTagDraft([editable(1)], "album").some(({ key }) => key === "lyrics")).toBe(false);
  });

  it("does not rewrite the cached snapshot without an edited field", async () => {
    const { editor, saves, synchronized } = fixture();
    await editor.openTracks([1]);
    editor.prepareSave();
    await settle();
    expect(saves).toEqual([]);
    expect(synchronized).toEqual([]);
    expect(editor.state.error).toBe("没有可写入的字段。");
    expect(editor.state.open).toBe(true);
  });

  it("deduplicates targets and leaves mixed batch values unapplied", async () => {
    const { editor, saves } = fixture();
    await editor.openTracks([1, 1, 2]);
    expect(editor.state.tracks).toHaveLength(2);
    const title = editor.state.draft.find(({ key }) => key === "title");
    if (!title) throw new Error("Missing title field");
    expect(title.mixed).toBe(true);
    expect(buildTagChanges(editor.state.draft).some(({ field }) => field === "title")).toBe(false);
    editor.changeField(title, "Unified");
    editor.prepareSave();
    expect(saves).toHaveLength(1);
    await settle();
    expect(saves[0]?.ids).toEqual([1, 2]);
    expect(saves[0]?.changes).toEqual([{ field: "title", value: "Unified" }]);
    expect(saves[0]?.changes.find(({ field }) => field === "title")?.value).toBe("Unified");
    expect(saves[0]?.changes.some(({ field }) => field === "trackNumber")).toBe(false);
  });

  it("leaves unchanged common values unselected and removes labels emptied by typing", async () => {
    const { editor, saves } = fixture();
    await editor.openTracks([1, 2]);
    const date = editor.state.draft.find(({ key }) => key === "releaseDate");
    if (!date) throw new Error("Missing date");
    editor.changeField(date, "");
    editor.prepareSave();
    await settle();
    expect(saves[0]?.changes.some(({ field }) => field === "artist")).toBe(false);
    expect(saves[0]?.changes.find(({ field }) => field === "releaseDate")?.value).toBeNull();
  });

  it("album editing hides per-track numbering and titles even for a one-track album", async () => {
    const { editor } = fixture({ loadAlbum: async () => [1] });
    await editor.openAlbum({ albumArtist: "Album Artist", album: "Album" });
    expect(editor.state.draft.map(({ key }) => key)).toEqual([
      "artist",
      "albumArtist",
      "album",
      "artistSort",
      "albumArtistSort",
      "discSubtitle",
      "label",
      "releaseDate",
      "originalReleaseDate",
      "trackTotal",
      "discTotal",
    ]);
    expect(buildTagChanges(editor.state.draft)).toHaveLength(11);
  });

  it("only enables fields writable on every target and retains database information for unreadable files", () => {
    const readOnly = editable(2);
    readOnly.writableFields = [];
    readOnly.issue = "文件不存在";
    const draft = createTagDraft([editable(1), readOnly], "tracks");
    expect(draft.every(({ writable }) => !writable)).toBe(true);
    expect(draft.find(({ key }) => key === "artist")?.value).toBe("Artist");
    const partial = editable(2);
    partial.writableFields = ["title"];
    const intersection = createTagDraft([editable(1), partial], "tracks");
    expect(intersection.find(({ key }) => key === "title")?.writable).toBe(true);
    expect(intersection.find(({ key }) => key === "album")?.writable).toBe(false);
  });

  it("validates dates and positive numbers before submitting", () => {
    const draft = createTagDraft([editable(1)], "tracks");
    const date = draft.find(({ key }) => key === "releaseDate");
    const number = draft.find(({ key }) => key === "trackNumber");
    if (!date || !number) throw new Error("Missing fields");
    for (const value of ["2023-02-29", "2024-04-31", "0000", "2024-13", "2024-2"]) {
      date.value = value;
      expect(() => buildTagChanges(draft)).toThrow("发行日期");
    }
    for (const value of ["2024", "2024-02", "2024-02-29"]) {
      date.value = value;
      expect(buildTagChanges(draft)).toHaveLength(14);
    }
    for (const value of ["0", "-1", "1.1", "4294967296"]) {
      number.value = value;
      expect(() => buildTagChanges(draft)).toThrow("正整数");
    }
  });

  it("validates changed totals against every target while preserving untouched mixed numbers", async () => {
    const { editor } = fixture();
    await editor.openTracks([1, 2]);
    const total = editor.state.draft.find(({ key }) => key === "trackTotal");
    const title = editor.state.draft.find(({ key }) => key === "title");
    if (!total || !title) throw new Error("Missing fields");
    editor.changeField(total, "1");
    editor.prepareSave();
    expect(editor.state.error).toContain("编号不能大于对应总数");
    editor.changeField(total, "");
    editor.changeField(title, "");
    const changes = buildTagChanges(editor.state.draft, editor.state.tracks);
    expect(changes.find(({ field }) => field === "trackTotal")?.value).toBeNull();
    expect(changes.find(({ field }) => field === "title")?.value).toBeNull();
    expect(changes.some(({ field }) => field === "trackNumber")).toBe(false);
  });

  it("preserves per-track results after partial failure without a retry entry", async () => {
    const calls: MetadataTarget[][] = [];
    const { editor, synchronized } = fixture({
      save: async (ids, _changes, progress) => {
        calls.push(ids);
        const results = ids.map((id) => result(id, calls.length > 1 || id === 1));
        for (const entry of results) progress(entry);
        return results;
      },
    });
    await editor.openTracks([1, 2]);
    const album = editor.state.draft.find(({ key }) => key === "album");
    if (!album) throw new Error("Missing album");
    editor.changeField(album, "New Album");
    editor.prepareSave();
    await settle();
    expect(editor.state.open).toBe(true);
    expect(editor.state.results).toHaveLength(2);
    expect(synchronized).toEqual([[1]]);
    expect(calls).toEqual([[1, 2]]);
    expect(editor.state.results.map(({ databaseUpdated }) => databaseUpdated)).toEqual([
      true,
      false,
    ]);
    expect("retryFailed" in editor).toBe(false);
    expect(editor.state.dirty).toBe(true);
  });

  it("sends a bulk mark action without rewriting unchanged tags", async () => {
    const actions: string[] = [];
    const { editor, saves } = fixture({
      save: async (ids, changes, _progress, action) => {
        saves.push({ ids, changes });
        actions.push(action);
        return ids.map((id) => result(id));
      },
    });
    await editor.openAlbum({ album: "Album", albumArtist: "Artist" });
    expect(editor.state.lyricsAction).toBe("keep");
    editor.changeLyricsAction("mark");
    editor.prepareSave();
    await settle();
    expect(actions).toEqual(["mark"]);
    expect(saves).toEqual([{ ids: [1, 2], changes: [] }]);
  });

  it("clears the single-track draft when marking and cancels the mark when new lyrics are entered", async () => {
    const { editor } = fixture();
    await editor.openTracks([1]);
    const lyrics = editor.state.draft.find(({ key }) => key === "lyrics");
    if (!lyrics) throw new Error("Missing lyrics");
    editor.changeLyricsAction("mark");
    expect(lyrics.value).toBe("");
    expect(editor.state.dirty).toBe(true);
    editor.changeField(lyrics, "New lyrics");
    expect(editor.state.lyricsAction).toBe("keep");
  });

  it("can cancel a mark for unwritable tracks with no file changes", async () => {
    const calls: Array<{ changes: TagChange[]; action: string }> = [];
    const { editor } = fixture({
      loadTracks: async (ids) =>
        ids.map((id) => ({ ...editable(id), lyrics: null, noLyrics: true, writableFields: [] })),
      save: async (ids, changes, _progress, action) => {
        calls.push({ changes, action });
        return ids.map((id) => ({ ...result(id), fileWritten: false }));
      },
    });
    await editor.openTracks([1, 2]);
    editor.changeLyricsAction("unmark");
    editor.prepareSave();
    await settle();
    expect(calls).toEqual([{ changes: [], action: "unmark" }]);
    expect(editor.state.open).toBe(false);
  });

  it("preserves mark outcomes and the selected action after partial failure", async () => {
    const calls: Array<{ ids: MetadataTarget[]; action: string }> = [];
    const { editor } = fixture({
      save: async (ids, _changes, _progress, action) => {
        calls.push({ ids, action });
        return ids.map((id) => result(id, calls.length > 1 || id === 1));
      },
    });
    await editor.openTracks([1, 2]);
    editor.changeLyricsAction("mark");
    editor.prepareSave();
    await settle();
    expect(calls).toEqual([{ ids: [1, 2], action: "mark" }]);
    expect(editor.state.lyricsAction).toBe("mark");
    expect(editor.state.results.map(({ databaseUpdated }) => databaseUpdated)).toEqual([
      true,
      false,
    ]);
  });

  it("requires discard confirmation only after editing and prevents closing while saving", async () => {
    let finish: (value: MetadataSaveResult[]) => void = () => {};
    const { editor } = fixture({
      save: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await editor.openTracks([1]);
    const field = editor.state.draft[0];
    if (!field) throw new Error("Missing field");
    editor.changeField(field, "new");
    editor.requestClose();
    expect(editor.state.confirmDiscard).toBe(true);
    expect(editor.state.open).toBe(true);
    editor.state.confirmDiscard = false;
    editor.prepareSave();
    editor.requestClose();
    editor.close();
    expect(editor.state.open).toBe(true);
    expect(editor.state.saving).toBe(true);
    finish([result(1)]);
    await settle();
    expect(editor.state.open).toBe(false);
  });

  it("retains the dialog and changes after a failed save", async () => {
    const { editor } = fixture({
      save: async () => {
        throw new Error("正在扫描");
      },
    });
    await editor.openTracks([1]);
    const album = editor.state.draft.find(({ key }) => key === "album");
    if (!album) throw new Error("Missing album");
    editor.changeField(album, "New Album");
    editor.prepareSave();
    await settle();
    expect(editor.state.open).toBe(true);
    expect(editor.state.error).toBe("正在扫描");
    expect(editor.state.saving).toBe(false);
  });

  it("retains successful results after synchronization failure without a refresh retry entry", async () => {
    let attempts = 0;
    const { editor, saves } = fixture({
      synchronize: async () => {
        attempts++;
        if (attempts === 1) throw new Error("reload failed");
      },
    });
    await editor.openTracks([1]);
    const album = editor.state.draft.find(({ key }) => key === "album");
    if (!album) throw new Error("Missing album");
    editor.changeField(album, "New Album");
    editor.prepareSave();
    await settle();
    expect(editor.state.open).toBe(true);
    expect(editor.state.dirty).toBe(false);
    expect(editor.state.results[0]?.databaseUpdated).toBe(true);
    expect(editor.state.synchronizationError).toContain("reload failed");
    expect(typeof editor.retrySynchronization).toBe("function");
    expect(attempts).toBe(1);
    editor.prepareSave();
    await settle();
    expect(attempts).toBe(2);
    expect(saves).toHaveLength(1);
    expect(editor.state.results[0]?.databaseUpdated).toBe(true);
    expect(editor.state.open).toBe(false);
  });

  it("releases every mark target even without cached lyrics, but not for unmarking", async () => {
    const editing: MetadataTarget[][] = [];
    const { editor } = fixture({
      loadTracks: async (ids) =>
        ids.map((id) => ({ ...editable(id), lyrics: id === 1 ? "Old lyrics" : null })),
      editFiles: (ids, save) => {
        editing.push([...ids]);
        return save();
      },
    });
    await editor.openTracks([1, 2]);
    editor.changeLyricsAction("mark");
    editor.prepareSave();
    await settle();
    expect(editing).toEqual([[1, 2]]);
    await editor.openTracks([1, 2]);
    editor.changeLyricsAction("unmark");
    editor.prepareSave();
    await settle();
    expect(editing).toEqual([[1, 2]]);
  });

  it("ignores late reads after the dialog is closed and reopened", async () => {
    let finish: (tracks: EditableTrack[]) => void = () => {};
    let calls = 0;
    const { editor } = fixture({
      loadTracks: async () => {
        calls += 1;
        if (calls === 1)
          return new Promise((resolve) => {
            finish = resolve;
          });
        return [editable(2)];
      },
    });
    const oldOpen = editor.openTracks([1]);
    await settle();
    editor.requestClose();
    await editor.openTracks([2]);
    finish([editable(1)]);
    await oldOpen;
    expect(editor.state.tracks[0]?.track.id).toBe(2);
  });
});

function collections(ids: number[]): ArtworkCollection[] {
  return ids.map((trackId) => ({
    trackId,
    pictures: [
      {
        contentId: "common",
        mimeType: "image/png",
        byteLength: 1,
        pictureType: trackId === 1 ? 3 : 4,
        artworkId: trackId * 10,
        source: "embedded",
        path: "",
        error: null,
      },
      {
        contentId: `hidden:${trackId}`,
        mimeType: "image/png",
        byteLength: 1,
        pictureType: 0,
        artworkId: trackId * 10 + 1,
        source: "embedded",
        path: "",
        error: null,
      },
    ],
    displayIndex: trackId === 1 ? 0 : 1,
    error: null,
  }));
}

describe("manual artwork collections", () => {
  it("edits only common pictures and saves full DB-only collections without releasing playback", async () => {
    const editing: MetadataTarget[][] = [];
    const requests: ArtworkDraft[][] = [];
    const { editor } = fixture({
      planArtwork: async (drafts) =>
        drafts.map(({ trackId }) => ({ trackId, fileWriteRequired: false, error: null })),
      loadCollections: async (ids) => collections(ids),
      editFiles: (ids, execute) => {
        editing.push([...ids]);
        return execute();
      },
      save: async (ids, changes, _progress, _action, _operation, drafts) => {
        expect(changes).toEqual([]);
        expect(drafts).toBeDefined();
        requests.push(drafts);
        return ids.map((id) => ({ ...result(id), fileWritten: false }));
      },
    });
    await editor.openTracks([1, 2]);
    expect(editor.pictures.value.map(({ key }) => key)).toEqual(["common"]);
    expect(editor.pictures.value[0]?.mixed).toBe(true);
    expect(editor.pictures.value[0]?.pictureType).toBeNull();
    expect(editor.displayPicture.value.mixed).toBe(true);
    editor.changePictureType("hidden:1", 5);
    expect(editor.state.error).toContain("共有");
    editor.changePictureType("common", 5);
    editor.setDisplayPicture("common");
    editor.prepareSave();
    await settle();
    expect(editing).toEqual([]);
    expect(requests[0]).toEqual(
      [1, 2].map((trackId) => ({
        trackId,
        pictures: [
          { source: "existing", artworkId: trackId * 10, pictureType: 5 },
          { source: "existing", artworkId: trackId * 10 + 1, pictureType: 0 },
        ],
        displayIndex: 0,
      })),
    );
    expect(editor.state.results.map(({ fileWritten }) => fileWritten)).toEqual([false, false]);
  });

  it("embedded type edits write audio and saved drafts reset on each open", async () => {
    const editing: MetadataTarget[][] = [];
    const requests: ArtworkDraft[][] = [];
    const { editor } = fixture({
      loadCollections: async (ids) => collections(ids),
      editFiles: (ids, execute) => {
        editing.push([...ids]);
        return execute();
      },
      save: async (ids, changes, _progress, _action, _operation, drafts) => {
        expect(changes).toEqual([]);
        expect(drafts).toBeDefined();
        requests.push(drafts);
        return ids.map((id) => result(id));
      },
    });
    await editor.openTracks([1, 2]);
    editor.changePictureType("common", 5);
    expect(editor.state.dirty).toBe(true);
    editor.prepareSave();
    await settle();
    expect(editing).toEqual([[1, 2]]);
    expect(requests[0]?.map(({ pictures }) => pictures.length)).toEqual([2, 2]);
    expect(editor.state.open).toBe(false);
    await editor.openTracks([1]);
  });

  it("deletes common pictures without removing hidden pictures or leaving display empty", async () => {
    const { editor } = fixture({ loadCollections: async (ids) => collections(ids) });
    await editor.openTracks([1, 2]);
    editor.deletePicture("common");
    expect(editor.pictures.value).toEqual([]);
    expect(editor.state.artwork.tracks.map(({ displayKey }) => displayKey)).toEqual([
      "hidden:1",
      "hidden:2",
    ]);
    expect(editor.state.artwork.tracks.map(({ pictures }) => pictures.length)).toEqual([1, 1]);
    editor.requestClose();
    expect(editor.state.confirmDiscard).toBe(true);
    editor.close();
    await editor.openTracks([1, 2]);
    expect(editor.pictures.value.map(({ key }) => key)).toEqual(["common"]);
  });

  it("disables collection operations after load failure but still saves tags without artwork drafts", async () => {
    const requests: ArtworkDraft[][] = [];
    const { editor } = fixture({
      loadCollections: async () => {
        throw new Error("collection read failed");
      },
      save: async (ids, _changes, _progress, _action, _operation, drafts) => {
        requests.push(drafts);
        expect(drafts).toBeDefined();
        return ids.map((id) => result(id));
      },
    });
    await editor.openTracks([1]);
    expect(editor.artworkReady.value).toBe(false);
    await editor.addPicture(new Uint8Array([1]), "image/png");
    editor.deletePicture("common");
    expect(editor.state.artwork.tracks[0]?.pictures).toEqual([]);
    const field = editor.state.draft.find(({ key }) => key === "title");
    if (!field) throw new Error("Missing title");
    editor.changeField(field, "New title");
    editor.prepareSave();
    await settle();
    expect(requests).toEqual([[]]);
  });

  it("ignores a collection response from a closed editor", async () => {
    let finish: (value: ArtworkCollection[]) => void = () => {};
    let count = 0;
    const { editor } = fixture({
      loadCollections: async (ids) => {
        if (++count === 1)
          return new Promise((resolve) => {
            finish = resolve;
          });
        return collections(ids);
      },
    });
    const first = editor.openTracks([1]);
    await settle();
    editor.close();
    await editor.openTracks([2]);
    finish(collections([1]));
    await first;
    expect(editor.state.artwork.tracks.map(({ trackId }) => trackId)).toEqual([2]);
  });
});

describe("manual collection refresh boundaries", () => {
  it("keeps every editing and closing operation gated until saved artwork reload finishes", async () => {
    let reads = 0;
    let finish: (value: ArtworkCollection[]) => void = () => {};
    const { editor, saves } = fixture({
      loadCollections: async (ids) => {
        if (++reads === 1) return collections(ids);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    await editor.openTracks([1]);
    editor.changePictureType("common", 5);
    const title = editor.state.draft.find(({ key }) => key === "title");
    if (!title) throw new Error("Missing title");
    editor.changeField(title, "Saved title");
    editor.prepareSave();
    await settle();
    expect(editor.state.results[0]?.databaseUpdated).toBe(true);
    expect(editor.state.saving).toBe(true);
    editor.changeField(title, "Blocked title");
    editor.changeLyricsAction("mark");
    editor.changePictureType("common", 8);
    editor.deletePicture("common");
    editor.setDisplayPicture("hidden:1");
    await editor.addPicture(Uint8Array.from([9]), "image/png");
    editor.prepareSave();
    await editor.save();
    await editor.retrySynchronization();
    editor.requestClose();
    editor.close();
    expect(title.value).toBe("Saved title");
    expect(editor.state.lyricsAction).toBe("keep");
    expect(editor.pictures.value.find(({ key }) => key === "common")?.pictureType).toBe(5);
    expect(editor.state.artwork.tracks[0]?.pictures).toHaveLength(2);
    expect(editor.state.artwork.tracks[0]?.displayKey).toBe("common");
    expect(editor.state.open).toBe(true);
    expect(editor.state.confirmDiscard).toBe(false);
    expect(saves).toHaveLength(1);
    finish(collections([1]));
    await settle();
    expect(editor.state.saving).toBe(false);
    expect(editor.state.dirty).toBe(false);
    expect(editor.state.open).toBe(false);
  });

  it("keeps a saved editor clean and open after artwork refresh failure, then closes on retry", async () => {
    let reads = 0;
    let failReload = true;
    const { editor, saves } = fixture({
      loadCollections: async (ids) => {
        if (++reads > 1 && failReload) throw new Error("artwork refresh failed");
        return collections(ids);
      },
    });
    await editor.openTracks([1]);
    editor.changePictureType("common", 5);
    editor.prepareSave();
    await settle();
    expect(editor.state.dirty).toBe(false);
    expect(editor.state.open).toBe(true);
    expect(editor.artworkReady.value).toBe(false);
    failReload = false;
    editor.prepareSave();
    await settle();
    expect(editor.state.open).toBe(false);
    expect(editor.artworkReady.value).toBe(true);
    expect(saves).toHaveLength(1);
  });

  it("keeps descriptor errors unavailable and never sends a draft for a failed target", async () => {
    const sent: ArtworkDraft[][] = [];
    const { editor } = fixture({
      loadCollections: async (ids) =>
        collections(ids).map((collection) =>
          collection.trackId === 2 ? { ...collection, error: "Unreadable artwork" } : collection,
        ),
      save: async (ids, _changes, _progress, _action, _operation, drafts) => {
        sent.push(drafts);
        return ids.map((id) => ({ ...result(id), fileWritten: false }));
      },
    });
    await editor.openTracks([1, 2]);
    expect(editor.artworkReady.value).toBe(false);
    expect(editor.pictures.value).toEqual([]);
    editor.changePictureType("common", 5);
    editor.changeLyricsAction("unmark");
    editor.prepareSave();
    await settle();
    expect(sent).toEqual([[]]);
  });
});

describe("artwork file write planning", () => {
  it("closes without writing when a linked addition is deleted before saving", async () => {
    const { editor, saves, synchronized } = fixture({
      planArtwork: async () => {
        throw new Error("No changes to plan");
      },
      editFiles: () => {
        throw new Error("No files to write");
      },
    });
    await editor.openTracks([1]);
    const key = await editor.addPicture(Uint8Array.from([1]), "image/png", 3, "D:/cover.png");
    if (!key) throw new Error("Missing picture");
    editor.deletePicture(key);
    editor.prepareSave();
    await settle();
    expect(editor.state.error).toBe("");
    expect(editor.state.open).toBe(false);
    expect(editor.state.dirty).toBe(false);
    expect(editor.pictures.value).toEqual([]);
    expect(saves).toEqual([]);
    expect(synchronized).toEqual([]);
  });
  it("does not lock broken linked paths and can change type or detach them without file writes", async () => {
    const { editor, saves } = fixture({
      loadCollections: async (ids) =>
        collections(ids).map((collection) => ({
          ...collection,
          pictures: collection.pictures.map((picture, index) =>
            index
              ? picture
              : { ...picture, source: "manual", path: "/missing.png", error: "missing" },
          ),
        })),
      planArtwork: async (drafts) =>
        drafts.map(({ trackId }) => ({ trackId, fileWriteRequired: false, error: null })),
      editFiles: () => {
        throw new Error("must not release playback");
      },
    });
    await editor.openTracks([1, 2]);
    expect(editor.artworkReady.value).toBe(true);
    editor.changePictureType("linked:/missing.png", 8);
    expect(editor.pictures.value[0]?.pictureType).toBe(8);
    editor.deletePicture("linked:/missing.png");
    editor.prepareSave();
    await settle();
    expect(saves).toHaveLength(1);
    expect(editor.state.results.every(({ databaseUpdated }) => databaseUpdated)).toBe(true);
  });
});
