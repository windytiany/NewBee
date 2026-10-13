import { describe, expect, it } from "bun:test";
import {
  acceptCollectionChanges,
  addPicture,
  changePictureType,
  collectionChanged,
  commonPictures,
  createCollectionDraft,
  deletePicture,
  displaySelection,
  serializeCollections,
  setDisplayPicture,
} from "@/features/artwork/collection/model";
import type { ArtworkCollection, ArtworkPicture } from "@/features/artwork/collection/types";

function picture(contentId: string, pictureType = 3, embedded = false): ArtworkPicture {
  return { contentId, pictureType, embedded, mimeType: "image/png", byteLength: 3 };
}
function collection(
  trackId: number,
  pictures: ArtworkPicture[],
  displayIndex: number | null = pictures.length ? 0 : null,
): ArtworkCollection {
  return { trackId, pictures, displayIndex, error: null };
}
const content = async () => Uint8Array.from([1, 2, 3]).buffer;

describe("artwork collection draft", () => {
  it("intersects content independently of type and leaves private pictures untouched", () => {
    const draft = createCollectionDraft(
      [1, 2],
      [
        collection(1, [picture("shared", 3), picture("private1", 4)]),
        collection(2, [picture("private2", 8), picture("shared", 4)], 1),
      ],
    );
    expect(commonPictures(draft)).toEqual([
      { key: "shared", mimeType: "image/png", byteLength: 3, pictureType: null, mixed: true },
    ]);
    expect(displaySelection(draft).mixed).toBe(false);
    changePictureType(draft, "shared", 20);
    expect(commonPictures(draft)[0]?.pictureType).toBe(20);
    expect(() => changePictureType(draft, "shared", 21)).toThrow("图片类型");
    expect(() => deletePicture(draft, "private1")).toThrow("共有");
    deletePicture(draft, "shared");
    expect(draft.tracks.map((track) => track.pictures.map(({ key }) => key))).toEqual([
      ["private1"],
      ["private2"],
    ]);
    expect(displaySelection(draft).mixed).toBe(true);
    expect(serializeCollections(draft).map(({ displayIndex }) => displayIndex)).toEqual([0, 0]);
  });

  it("detects mixed display including empty/nonempty and ignores picture type differences", () => {
    expect(
      displaySelection(
        createCollectionDraft([1, 2], [collection(1, []), collection(2, [picture("a")])]),
      ).mixed,
    ).toBe(true);
    expect(
      displaySelection(createCollectionDraft([1, 2], [collection(1, []), collection(2, [])])),
    ).toEqual({ mixed: false, picture: null });
    const draft = createCollectionDraft(
      [1, 2],
      [
        collection(1, [picture("a"), picture("b")]),
        collection(2, [picture("a", 4), picture("b")], 1),
      ],
    );
    expect(displaySelection(draft).mixed).toBe(true);
    setDisplayPicture(draft, "a");
    expect(displaySelection(draft).mixed).toBe(false);
  });

  it("falls back to front, embedded, then stable order without letting type changes steal display", () => {
    const draft = createCollectionDraft(
      [1],
      [
        collection(1, [
          picture("display"),
          picture("stable", 4),
          picture("embedded", 4, true),
          picture("front", 3),
        ]),
      ],
    );
    deletePicture(draft, "display");
    expect(draft.tracks[0]?.displayKey).toBe("front");
    changePictureType(draft, "stable", 3);
    expect(draft.tracks[0]?.displayKey).toBe("front");
    changePictureType(draft, "stable", 4);
    deletePicture(draft, "front");
    expect(draft.tracks[0]?.displayKey).toBe("embedded");
    deletePicture(draft, "embedded");
    expect(draft.tracks[0]?.displayKey).toBe("stable");
    deletePicture(draft, "stable");
    expect(serializeCollections(draft)).toEqual([{ trackId: 1, pictures: [], displayIndex: null }]);
  });

  it("hashes imports, deduplicates new content, and never steals display", async () => {
    const draft = createCollectionDraft(
      [1, 2],
      [collection(1, [picture("old", 4)]), collection(2, [])],
    );
    const key = await addPicture(draft, Uint8Array.from([4, 5]), "image/jpeg", content);
    await addPicture(draft, Uint8Array.from([4, 5]), "image/png", content, 8);
    expect(draft.tracks.map(({ pictures }) => pictures.length)).toEqual([2, 1]);
    expect(draft.tracks.map(({ displayKey }) => displayKey)).toEqual(["old", key]);
    expect(commonPictures(draft)[0]?.pictureType).toBe(3);
    const serialized = serializeCollections(draft);
    expect(serialized[0]?.pictures[1]).toEqual({ source: "new", data: [4, 5], pictureType: 3 });
    const entry = serialized[0]?.pictures[1];
    if (entry?.source === "new") entry.data[0] = 99;
    expect(serializeCollections(draft)[0]?.pictures[1]).toEqual({
      source: "new",
      data: [4, 5],
      pictureType: 3,
    });
  });

  it("compares originals by bytes and uses existing references only on their own track", async () => {
    const draft = createCollectionDraft(
      [1, 2],
      [collection(1, [picture("existing", 4, true)]), collection(2, [])],
    );
    const reads: string[] = [];
    const key = await addPicture(draft, Uint8Array.from([1, 2, 3]), "image/png", async (id) => {
      reads.push(id);
      return content();
    });
    expect(key).toBe("existing");
    expect(reads).toEqual(["existing"]);
    expect(draft.tracks[0]?.pictures).toHaveLength(1);
    expect(commonPictures(draft)[0]?.mixed).toBe(true);
    expect(serializeCollections(draft)).toEqual([
      {
        trackId: 2,
        pictures: [{ source: "new", data: [1, 2, 3], pictureType: 3 }],
        displayIndex: 0,
      },
    ]);
    expect(serializeCollections(draft, true)[0]?.pictures).toEqual([
      { source: "existing", contentId: "existing", pictureType: 4 },
    ]);
  });

  it("preserves draft atomically if original reading fails", async () => {
    const draft = createCollectionDraft([1], [collection(1, [picture("a")])]);
    await expect(
      addPicture(draft, Uint8Array.from([1]), "image/png", async () => {
        throw new Error("read failed");
      }),
    ).rejects.toThrow("read failed");
    expect(serializeCollections(draft)).toEqual([]);
  });

  it("never serializes failed or missing collections, including embed requests", async () => {
    const failed = collection(2, []);
    failed.error = "load failed";
    const draft = createCollectionDraft([1, 2, 3], [collection(1, [picture("a")]), failed]);
    expect(commonPictures(draft)).toEqual([]);
    expect(() => deletePicture(draft, "a")).toThrow("成功加载");
    await expect(addPicture(draft, Uint8Array.from([1]), "image/png", content)).rejects.toThrow(
      "成功加载",
    );
    expect(serializeCollections(draft, true).map(({ trackId }) => trackId)).toEqual([1]);
    expect(draft.tracks[1]?.error).toBe("load failed");
    expect(draft.tracks[2]?.error).toContain("缺失");
  });

  it("prefers embedded fronts over earlier nonembedded fronts", () => {
    const draft = createCollectionDraft(
      [1],
      [collection(1, [picture("display"), picture("directory"), picture("embedded", 3, true)])],
    );
    deletePicture(draft, "display");
    expect(draft.tracks[0]?.displayKey).toBe("embedded");
  });

  it("does not duplicate equal bytes with distinct existing content IDs", async () => {
    const draft = createCollectionDraft(
      [1, 2],
      [collection(1, [picture("a", 4)]), collection(2, [picture("b", 8)])],
    );
    await addPicture(draft, Uint8Array.from([1, 2, 3]), "image/png", content);
    expect(draft.tracks.map(({ pictures }) => pictures.length)).toEqual([1, 1]);
    expect(serializeCollections(draft)).toEqual([]);
    expect(commonPictures(draft)[0]?.mixed).toBe(true);
    expect(serializeCollections(draft, true).map(({ pictures }) => pictures[0])).toEqual([
      { source: "existing", contentId: "a", pictureType: 4 },
      { source: "existing", contentId: "b", pictureType: 8 },
    ]);
  });

  it("reimports deleted existing bytes as front without changing surviving displays", async () => {
    const draft = createCollectionDraft([1], [collection(1, [picture("a", 4), picture("b", 8)])]);
    deletePicture(draft, "a");
    const key = await addPicture(
      draft,
      Uint8Array.from([1, 2, 3]),
      "image/png",
      async (id) => Uint8Array.from(id === "a" ? [1, 2, 3] : [4, 5, 6]).buffer,
    );
    expect(key).toBe("a");
    expect(draft.tracks[0]?.displayKey).toBe("b");
    expect(serializeCollections(draft)[0]?.pictures[1]).toEqual({
      source: "existing",
      contentId: "a",
      pictureType: 3,
    });
  });

  it("detects actual changes and accepts successes independently of failed targets", () => {
    const draft = createCollectionDraft(
      [1, 2],
      [collection(1, [picture("a")]), collection(2, [picture("a")])],
    );
    changePictureType(draft, "a", 4);
    changePictureType(draft, "a", 3);
    expect(serializeCollections(draft)).toEqual([]);
    changePictureType(draft, "a", 4);
    acceptCollectionChanges(draft, [1]);
    expect(draft.tracks.map(collectionChanged)).toEqual([false, true]);
    expect(serializeCollections(draft).map(({ trackId }) => trackId)).toEqual([2]);
    expect(serializeCollections(draft, true).map(({ trackId }) => trackId)).toEqual([1, 2]);
  });

  it("accepts successful embedding provenance without marking it as a new change", () => {
    const draft = createCollectionDraft(
      [1, 2],
      [collection(1, [picture("a", 4)]), collection(2, [picture("a", 4)])],
    );
    acceptCollectionChanges(draft, [1], true);
    expect(draft.tracks.map(({ pictures }) => pictures[0]?.embedded)).toEqual([true, false]);
    expect(serializeCollections(draft)).toEqual([]);
  });

  it("rejects invalid IDs and flags malformed responses without allowing writes", () => {
    expect(() => createCollectionDraft([0], [])).toThrow("曲目 ID");
    expect(() => createCollectionDraft([1], [collection(2, [])])).toThrow("不匹配");
    for (const entry of [
      collection(1, [picture("a", -1)]),
      collection(1, [picture("a"), picture("a")]),
      collection(1, [picture("a")], 4),
    ]) {
      const draft = createCollectionDraft([1], [entry]);
      expect(draft.tracks[0]?.error).not.toBeNull();
      expect(serializeCollections(draft, true)).toEqual([]);
    }
  });
});
