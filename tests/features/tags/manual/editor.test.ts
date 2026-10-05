import { describe, expect, it } from "bun:test";
import { createTagEditor } from "@/features/tags/manual/useEditor";
import type { TagEditorOptions } from "@/features/tags/manual/useEditor";
import { buildTagChanges, createTagDraft, TAG_FIELDS } from "@/features/tags/draft";
import type { EditableTrack, TagChange, TagSaveResult } from "@/features/tags/types";

function editable(id: number, title = `Track ${id}`): EditableTrack {
  return {
    track: {
      id,
      path: `/music/${id}.mp3`,
      title,
      artist: "Artist",
      album: "Album",
      albumArtist: "Album Artist",
      releaseDate: "2024-02-29",
      trackNumber: id,
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
    writableFields: [...TAG_FIELDS.map(({ key }) => key), "lyrics"],
    issue: null,
  };
}
function result(trackId: number, success = true): TagSaveResult {
  return {
    trackId,
    path: `/music/${trackId}.mp3`,
    fileWritten: success,
    databaseUpdated: success,
    error: success ? null : "文件只读",
  };
}
function fixture(overrides: Partial<TagEditorOptions> = {}) {
  const saves: Array<{ ids: number[]; changes: TagChange[] }> = [];
  const synchronized: number[][] = [];
  const editor = createTagEditor({
    loadTracks: async (ids) => ids.map((id) => editable(id)),
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
    notify: () => 1,
    ...overrides,
  });
  return { editor, saves, synchronized };
}
async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("metadata editing", () => {
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
    expect(saves[0]?.changes.find(({ field }) => field === "lyrics")?.value).toBe(
      "  [00:01.00]Edited lyrics\n\n",
    );
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

  it("saves all writable single-track database values without requiring changes", async () => {
    const { editor, saves, synchronized } = fixture();
    await editor.openTracks([1]);
    expect(editor.state.dirty).toBe(false);
    editor.prepareSave();
    await settle();
    expect(saves).toHaveLength(1);
    expect(saves[0]?.changes).toHaveLength(9);
    expect(saves[0]?.changes.find(({ field }) => field === "title")?.value).toBe("Track 1");
    expect(synchronized).toEqual([[1]]);
    expect(editor.state.open).toBe(false);
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
    expect(saves[0]?.changes).toHaveLength(8);
    expect(saves[0]?.changes.find(({ field }) => field === "title")?.value).toBe("Unified");
    expect(saves[0]?.changes.some(({ field }) => field === "trackNumber")).toBe(false);
  });

  it("saves unchanged common values and removes labels emptied by typing", async () => {
    const { editor, saves } = fixture();
    await editor.openTracks([1, 2]);
    const date = editor.state.draft.find(({ key }) => key === "releaseDate");
    if (!date) throw new Error("Missing date");
    editor.changeField(date, "");
    editor.prepareSave();
    await settle();
    expect(saves[0]?.changes.find(({ field }) => field === "artist")?.value).toBe("Artist");
    expect(saves[0]?.changes.find(({ field }) => field === "releaseDate")?.value).toBeNull();
  });

  it("album editing hides per-track numbering and titles even for a one-track album", async () => {
    const { editor } = fixture({ loadAlbum: async () => [1] });
    await editor.openAlbum({ albumArtist: "Album Artist", album: "Album" });
    expect(editor.state.draft.map(({ key }) => key)).toEqual([
      "artist",
      "albumArtist",
      "album",
      "releaseDate",
      "trackTotal",
      "discTotal",
    ]);
    expect(buildTagChanges(editor.state.draft)).toHaveLength(6);
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
      expect(buildTagChanges(draft)).toHaveLength(9);
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

  it("preserves successful results and retries only failed files", async () => {
    const calls: number[][] = [];
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
    editor.retryFailed();
    await settle();
    expect(calls).toEqual([[1, 2], [2]]);
    expect(synchronized).toEqual([[1], [2]]);
    expect(editor.state.results.every(({ databaseUpdated }) => databaseUpdated)).toBe(true);
    expect(editor.state.open).toBe(false);
  });

  it("requires discard confirmation only after editing and prevents closing while saving", async () => {
    let finish: (value: TagSaveResult[]) => void = () => {};
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
    editor.prepareSave();
    await settle();
    expect(editor.state.open).toBe(true);
    expect(editor.state.error).toBe("正在扫描");
    expect(editor.state.saving).toBe(false);
  });

  it("ignores duplicate and late progress after reopening the editor", async () => {
    let lateProgress: (entry: TagSaveResult) => void = () => {};
    const { editor } = fixture({
      save: async (ids, _changes, progress) => {
        lateProgress = progress;
        const entry = result(ids[0] ?? 1);
        progress(entry);
        progress(entry);
        expect(editor.state.completed).toBe(1);
        return [entry];
      },
    });
    await editor.openTracks([1]);
    editor.prepareSave();
    await settle();
    await editor.openTracks([2]);
    lateProgress(result(1));
    expect(editor.state.results).toHaveLength(0);
    expect(editor.state.completed).toBe(0);
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
