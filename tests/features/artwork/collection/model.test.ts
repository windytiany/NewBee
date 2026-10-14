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

function picture(contentId: string, pictureType = 3, path?: string): ArtworkPicture {
  return {
    artworkId: Array.from(contentId).reduce((sum, char) => sum + char.charCodeAt(0), 1),
    contentId,
    pictureType,
    source: path ? "manual" : "embedded",
    path: path ?? "",
    error: null,
    mimeType: "image/png",
    byteLength: 3,
  };
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
  it("intersects storage and content independently of type without changing private pictures", () => {
    const draft = createCollectionDraft(
      [1, 2],
      [
        collection(1, [picture("shared"), picture("private1", 4)]),
        collection(2, [picture("private2", 8), picture("shared", 4)], 1),
      ],
    );
    expect(
      commonPictures(draft).map(({ key, mixed, pictureType }) => ({ key, mixed, pictureType })),
    ).toEqual([{ key: "shared", mixed: true, pictureType: null }]);
    expect(displaySelection(draft).mixed).toBe(false);
    changePictureType(draft, "shared", 20);
    expect(commonPictures(draft)[0]?.pictureType).toBe(20);
    expect(() => changePictureType(draft, "shared", 21)).toThrow("图片类型");
    expect(() => deletePicture(draft, "private1")).toThrow("共有");
    deletePicture(draft, "shared");
    expect(draft.tracks.map(({ pictures }) => pictures.map(({ key }) => key))).toEqual([
      ["private1"],
      ["private2"],
    ]);
    expect(displaySelection(draft).mixed).toBe(true);
    expect(serializeCollections(draft).map(({ displayIndex }) => displayIndex)).toEqual([0, 0]);
  });
  it("detects mixed display including empty/nonempty and keeps type separate", () => {
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
  it("uses remaining first picture after deleting display, without type changes stealing it", () => {
    const draft = createCollectionDraft(
      [1],
      [collection(1, [picture("display"), picture("stable", 4), picture("front")])],
    );
    deletePicture(draft, "display");
    expect(draft.tracks[0]?.displayKey).toBe("stable");
    changePictureType(draft, "front", 8);
    expect(draft.tracks[0]?.displayKey).toBe("stable");
    deletePicture(draft, "stable");
    deletePicture(draft, "front");
    expect(serializeCollections(draft)).toEqual([{ trackId: 1, pictures: [], displayIndex: null }]);
  });
  it("deduplicates embedded content plus type and copies serialized bytes", async () => {
    const draft = createCollectionDraft(
      [1, 2],
      [collection(1, [picture("old", 4)]), collection(2, [])],
    );
    const key = await addPicture(draft, Uint8Array.from([4, 5]), "image/jpeg", content);
    await addPicture(draft, Uint8Array.from([4, 5]), "image/png", content);
    await addPicture(draft, Uint8Array.from([4, 5]), "image/png", content, 8);
    expect(draft.tracks.map(({ pictures }) => pictures.length)).toEqual([3, 2]);
    expect(draft.tracks.map(({ displayKey }) => displayKey)).toEqual(["old", key]);
    const serialized = serializeCollections(draft);
    const entry = serialized[0]?.pictures[1];
    expect(entry).toEqual({ source: "embedded", data: [4, 5], pictureType: 3 });
    if (entry?.source === "embedded") entry.data[0] = 99;
    expect(serializeCollections(draft)[0]?.pictures[1]).toEqual({
      source: "embedded",
      data: [4, 5],
      pictureType: 3,
    });
  });
  it("compares originals by bytes and never shares an existing artwork ID across tracks", async () => {
    const existing = picture("existing");
    const draft = createCollectionDraft([1, 2], [collection(1, [existing]), collection(2, [])]);
    const reads: number[] = [];
    await addPicture(draft, Uint8Array.from([1, 2, 3]), "image/png", async (id) => {
      reads.push(id);
      return content();
    });
    expect(reads).toEqual([existing.artworkId]);
    expect(draft.tracks[0]?.pictures).toHaveLength(1);
    expect(serializeCollections(draft)).toEqual([
      {
        trackId: 2,
        pictures: [{ source: "embedded", data: [1, 2, 3], pictureType: 3 }],
        displayIndex: 0,
      },
    ]);
    expect(commonPictures(draft)).toHaveLength(1);
  });
  it("preserves the draft atomically when embedded reading fails", async () => {
    const draft = createCollectionDraft([1], [collection(1, [picture("a")])]);
    await expect(
      addPicture(draft, Uint8Array.from([1]), "image/png", async () => {
        throw new Error("read failed");
      }),
    ).rejects.toThrow("read failed");
    expect(serializeCollections(draft)).toEqual([]);
  });
  it("does not serialize unchanged, failed or missing collections", async () => {
    const failed = { ...collection(2, []), error: "load failed" };
    const draft = createCollectionDraft([1, 2, 3], [collection(1, [picture("a")]), failed]);
    expect(commonPictures(draft)).toEqual([]);
    expect(() => deletePicture(draft, "a")).toThrow("成功加载");
    await expect(addPicture(draft, Uint8Array.from([1]), "image/png", content)).rejects.toThrow(
      "成功加载",
    );
    expect(serializeCollections(draft)).toEqual([]);
    expect(draft.tracks[1]?.error).toBe("load failed");
    expect(draft.tracks[2]?.error).toContain("缺失");
  });
  it("does not prefer embedded or front pictures over stable remaining order", () => {
    const draft = createCollectionDraft(
      [1],
      [
        collection(1, [
          picture("display"),
          picture("directory", 4, "/cover.png"),
          picture("embedded"),
        ]),
      ],
    );
    deletePicture(draft, "display");
    expect(draft.tracks[0]?.displayKey).toBe("linked:/cover.png");
  });
  it("keeps equal content with different embedded types separate and rejects a duplicate type change", () => {
    const first = picture("same", 3);
    const second = { ...picture("same", 4), artworkId: first.artworkId + 1 };
    const draft = createCollectionDraft([1], [collection(1, [first, second])]);
    expect(commonPictures(draft)).toHaveLength(2);
    expect(() => changePictureType(draft, "embedded:same:3", 4)).toThrow("已存在");
    expect(draft.tracks[0]?.pictures.map(({ picture }) => picture.pictureType)).toEqual([3, 4]);
  });
  it("reimports deleted originals only with a matching type and preserves remaining display", async () => {
    const first = picture("a");
    const draft = createCollectionDraft([1], [collection(1, [first, picture("b", 8)])]);
    deletePicture(draft, "a");
    await addPicture(
      draft,
      Uint8Array.from([1, 2, 3]),
      "image/png",
      async (id) => Uint8Array.from(id === first.artworkId ? [1, 2, 3] : [4, 5, 6]).buffer,
    );
    expect(draft.tracks[0]?.displayKey).toBe("b");
    expect(serializeCollections(draft)[0]?.pictures[1]).toEqual({
      source: "existing",
      artworkId: first.artworkId,
      pictureType: 3,
    });
  });
  it("accepts successes independently and detects reverted changes", () => {
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
  });
  it("accepts linked successes without changing storage provenance", async () => {
    const draft = createCollectionDraft([1], [collection(1, [])]);
    await addPicture(draft, Uint8Array.from([1]), "image/png", content, 3, "/cover.png");
    acceptCollectionChanges(draft, [1]);
    expect(draft.tracks[0]?.pictures[0]?.storage).toBe("linked");
    expect(serializeCollections(draft)).toEqual([]);
  });
  it("rejects invalid IDs, duplicate descriptors and invalid display indices", () => {
    expect(() => createCollectionDraft([0], [])).toThrow("曲目 ID");
    expect(() => createCollectionDraft([1], [collection(2, [])])).toThrow("不匹配");
    for (const entry of [
      collection(1, [picture("a", -1)]),
      collection(1, [picture("a"), picture("a")]),
      collection(1, [picture("a")], 4),
    ]) {
      const draft = createCollectionDraft([1], [entry]);
      expect(draft.tracks[0]?.error).not.toBeNull();
      expect(serializeCollections(draft)).toEqual([]);
    }
  });
  it("deduplicates normalized paths but keeps different paths with equal bytes and embedded bytes independent", async () => {
    const draft = createCollectionDraft([1, 2], [collection(1, []), collection(2, [])]);
    const data = Uint8Array.from([1, 2, 3]);
    await addPicture(draft, data, "image/png", content, 3, "C:\\Music\\cover.png");
    await addPicture(draft, data, "image/png", content, 4, "c:/Music/./cover.png");
    await addPicture(draft, data, "image/png", content, 3, "C:/Music/other.png");
    await addPicture(draft, data, "image/png", content);
    expect(draft.tracks.map(({ pictures }) => pictures.length)).toEqual([3, 3]);
    expect(serializeCollections(draft)[0]?.pictures.map(({ source }) => source)).toEqual([
      "linked",
      "linked",
      "embedded",
    ]);
    expect(commonPictures(draft)).toHaveLength(3);
  });
  it("keeps broken linked paths editable and excludes equal embedded bytes from their intersection", () => {
    const broken = { ...picture("same", 3, "/missing.png"), artworkId: 10000, error: "missing" };
    const draft = createCollectionDraft([1], [collection(1, [broken, picture("same")])]);
    expect(draft.tracks[0]?.error).toBeNull();
    changePictureType(draft, "linked:/missing.png", 8);
    expect(serializeCollections(draft)[0]?.pictures[0]?.pictureType).toBe(8);
    deletePicture(draft, "linked:/missing.png");
    expect(draft.tracks[0]?.displayKey).toBe("same");
    const mixed = createCollectionDraft(
      [1, 2],
      [collection(1, [picture("same")]), collection(2, [broken])],
    );
    expect(commonPictures(mixed)).toEqual([]);
  });
  it("pairs repeated embedded contents by original type even in reverse order, with stable edited keys", () => {
    const red3 = picture("red", 3);
    const red4 = { ...picture("red", 4), artworkId: red3.artworkId + 1 };
    const draft = createCollectionDraft(
      [1, 2],
      [collection(1, [red3, red4]), collection(2, [red4, red3])],
    );
    const keys = commonPictures(draft).map(({ key }) => key);
    expect(keys).toEqual(["embedded:red:3", "embedded:red:4"]);
    changePictureType(draft, "embedded:red:3", 8);
    expect(commonPictures(draft).map(({ key }) => key)).toEqual(keys);
    expect(
      draft.tracks.map(
        ({ pictures }) => pictures.find(({ key }) => key === "embedded:red:3")?.picture.pictureType,
      ),
    ).toEqual([8, 8]);
    deletePicture(draft, "embedded:red:3");
    expect(
      draft.tracks.map(({ pictures }) => pictures.map(({ picture }) => picture.pictureType)),
    ).toEqual([[4], [4]]);
  });
  it("uses type-specific keys on every target if only one target has repeated content", () => {
    const red3 = picture("red", 3);
    const red4 = { ...picture("red", 4), artworkId: red3.artworkId + 1 };
    const draft = createCollectionDraft(
      [1, 2],
      [collection(1, [red3, red4]), collection(2, [red4])],
    );
    expect(commonPictures(draft).map(({ key }) => key)).toEqual(["embedded:red:4"]);
    expect(() => deletePicture(draft, "embedded:red:3")).toThrow("共有");
    changePictureType(draft, "embedded:red:4", 8);
    expect(draft.tracks[0]?.pictures[0]?.picture.pictureType).toBe(3);
    deletePicture(draft, "embedded:red:4");
    expect(
      draft.tracks.map(({ pictures }) => pictures.map(({ picture }) => picture.pictureType)),
    ).toEqual([[3], []]);
    expect(draft.tracks[1]?.displayKey).toBeNull();
  });
  it("rejects malformed descriptor metadata while keeping a valid picture error editable", () => {
    for (const [field, value] of [
      ["byteLength", 0],
      ["byteLength", -1],
      ["byteLength", 1.5],
      ["byteLength", Number.MAX_SAFE_INTEGER + 1],
      ["byteLength", "3"],
      ["mimeType", true],
      ["mimeType", ""],
      ["contentId", 42],
      ["contentId", ""],
      ["path", null],
      ["source", "linked"],
      ["error", 42],
    ]) {
      const invalid = picture("a");
      Reflect.set(invalid, String(field), value);
      const draft = createCollectionDraft([1], [collection(1, [invalid])]);
      expect(draft.tracks[0]?.error).not.toBeNull();
      expect(serializeCollections(draft)).toEqual([]);
    }
    const invalid = collection(1, [picture("a")]);
    Reflect.set(invalid, "error", false);
    expect(createCollectionDraft([1], [invalid]).tracks[0]?.error).not.toBeNull();
  });
});
