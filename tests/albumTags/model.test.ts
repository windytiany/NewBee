import { describe, expect, it } from "bun:test";
import { assignTrack, buildAlbumPatches, createMatchRows, releaseId } from "@/albumTags/model";
import { METADATA_FIELDS } from "@/metadata/model";
import { local, release } from "./fixtures";
const fields = METADATA_FIELDS.map(({ key }) => key);

describe("album tag mapping", () => {
  it("accepts only release IDs and MusicBrainz release links", () => {
    const id = release().summary.id;
    expect(releaseId(id.toUpperCase())).toBe(id);
    expect(releaseId(`https://musicbrainz.org/release/${id}?foo=bar`)).toBe(id);
    for (const value of [
      `https://musicbrainz.org/release-group/${id}`,
      `https://evil.test/release/${id}`,
      "../../file",
    ])
      expect(releaseId(value)).toBeNull();
  });
  it("matches reordered files by title and leaves missing source slots empty", () => {
    const rows = createMatchRows(release(), [local(3), local(1), local(4)]);
    expect(rows.map((row) => row.trackId)).toEqual([1, null, 3, 4]);
  });
  it("keeps every local and source track in the table when their counts differ", () => {
    const locals = [local(1), local(2), local(3), local(4), local(5), local(6)];
    const rows = createMatchRows(release(), locals);
    expect(rows.map((row) => row.trackId)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.slice(4).every((row) => row.source === null)).toBe(true);
    expect(rows.flatMap((row) => (row.source ? [row.source.title] : []))).toEqual(
      release().tracks.map((track) => track.title),
    );
    const missing = createMatchRows(release(), [local(1)]);
    expect(missing.length).toBe(4);
    expect(missing.map((row) => row.trackId)).toEqual([1, null, null, null]);
  });
  it("keeps detached local tracks opposite a blank source and never writes tags or covers to them", () => {
    const locals = [local(1), local(2)];
    const rows = createMatchRows(release(), locals);
    assignTrack(rows, 1, null);
    expect(rows[0]?.trackId).toBeNull();
    const detached = rows.find((row) => row.trackId === 1);
    expect(detached?.source).toBeNull();
    detached!.values.album = "ignored";
    expect(buildAlbumPatches(rows, locals, fields, [1], true)).toEqual([]);
    const target = rows.findIndex((row) => row.source?.title === "Song 2");
    assignTrack(rows, 1, target);
    expect(rows.find((row) => row.source?.title === "Song 2")?.trackId).toBe(1);
    expect(rows.find((row) => row.trackId === 2)?.source).toBeNull();
    expect(
      rows
        .filter((row) => row.trackId !== null)
        .map((row) => row.trackId)
        .sort(),
    ).toEqual([1, 2]);
    expect(
      buildAlbumPatches(rows, locals, fields, [1, 2], true).map((patch) => patch.trackId),
    ).toEqual([1]);
  });
  it("matches only the second disc without shifting it to the first disc", () => {
    const rows = createMatchRows(release(), [local(3, "Song 3", 2), local(4, "Song 4", 2)]);
    expect(rows.map((row) => row.trackId)).toEqual([null, null, 3, 4]);
    const patches = buildAlbumPatches(rows, [local(3), local(4)], fields, [3, 4], false);
    expect(patches[0]?.changes).toContainEqual({ field: "discNumber", value: "2" });
    expect(patches[0]?.changes).toContainEqual({ field: "trackNumber", value: "1" });
    expect(patches[0]?.changes).toContainEqual({ field: "trackTotal", value: "2" });
  });
  it("swaps occupied slots, allows cross-disc movement and unmatched placement", () => {
    const rows = createMatchRows(release(), [local(1), local(2), local(3), local(4)]);
    assignTrack(rows, 1, 2);
    expect(rows.map((row) => row.trackId)).toEqual([3, 2, 1, 4]);
    assignTrack(rows, 1, null);
    expect(rows[2]?.trackId).toBeNull();
    assignTrack(rows, 1, 2);
    expect(rows[2]?.trackId).toBe(1);
    assignTrack(rows, 1, 100);
    expect(rows[2]?.trackId).toBe(1);
  });
  it("preserves missing values and supports explicit clearing without touching unchecked fields or files", () => {
    const source = release();
    source.summary.releaseDate = null;
    const locals = [local(1), local(2)];
    const rows = createMatchRows(source, locals);
    expect(buildAlbumPatches(rows, locals, ["releaseDate"], [1, 2], false)).toEqual([]);
    rows[0]!.values.releaseDate = "";
    rows[0]!.values.title = "new";
    expect(buildAlbumPatches(rows, locals, ["releaseDate"], [1], false)).toEqual([
      { trackId: 1, changes: [{ field: "releaseDate", value: null }], writeCover: false },
    ]);
  });
  it("writes only changes, supports cover-only updates and rejects duplicate mappings", () => {
    const locals = [local(1)];
    const rows = createMatchRows(release(), locals);
    expect(buildAlbumPatches(rows, locals, ["title"], [1], false)).toEqual([]);
    expect(buildAlbumPatches(rows, locals, [], [1], true)).toEqual([
      { trackId: 1, changes: [], writeCover: true },
    ]);
    rows[1]!.trackId = 1;
    expect(() => buildAlbumPatches(rows, locals, fields, [1], false)).toThrow("重复对应");
  });
  it("leaves file-format support to per-file backend validation so one unsupported target cannot block all files", () => {
    const unsupported = local(1);
    unsupported.writableFields = [];
    const locals = [unsupported, local(2)];
    const patches = buildAlbumPatches(
      createMatchRows(release(), locals),
      locals,
      fields,
      [1, 2],
      false,
    );
    expect(patches.map((patch) => patch.trackId)).toEqual([1, 2]);
  });
  it("validates editable dates and number totals before saving", () => {
    const locals = [local(1)];
    const rows = createMatchRows(release(), locals);
    rows[0]!.values.releaseDate = "2023-02-29";
    expect(() => buildAlbumPatches(rows, locals, fields, [1], false)).toThrow("发行日期");
    rows[0]!.values.releaseDate = "2016";
    rows[0]!.values.trackNumber = "3";
    expect(() => buildAlbumPatches(rows, locals, fields, [1], false)).toThrow("编号不能大于");
  });
});
