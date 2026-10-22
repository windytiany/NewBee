import { describe, expect, it } from "bun:test";
import { createManualSave } from "@/features/metadata/manual/save";
import type { ManualSaveOptions } from "@/features/metadata/manual/save";
import type { ArtworkCollection, ArtworkDraft } from "@/features/artwork/collection/types";
import {
  addPicture,
  changePictureType,
  createCollectionDraft,
} from "@/features/artwork/collection/model";
import type { MetadataSaveResult, TagChange } from "@/features/metadata/types";

function result(trackId: number, success = true): MetadataSaveResult {
  return {
    trackId,
    path: `/music/${trackId}.mp3`,
    fileWritten: success,
    databaseUpdated: success,
    error: success ? null : "文件只读",
  };
}
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
function fixture(overrides: Partial<ManualSaveOptions> = {}, ids = [1, 2]) {
  const saves: Array<{ ids: number[]; changes: TagChange[]; artwork: ArtworkDraft[] }> = [];
  const synchronized: number[][] = [];
  const editing: number[][] = [];
  const save = createManualSave({
    loadCollections: async (ids) => collections(ids),
    planArtwork: async (drafts) =>
      drafts.map(({ trackId }) => ({ trackId, fileWriteRequired: true, error: null })),
    save: async (ids, changes, progress, _action, _operation, artwork) => {
      saves.push({ ids, changes, artwork });
      const results = ids.map((id) => result(id));
      results.forEach(progress);
      return results;
    },
    editFiles: (ids, execute) => {
      editing.push([...ids]);
      return execute();
    },
    synchronize: async (ids) => {
      synchronized.push(ids);
    },
    ...overrides,
  });
  save.setTargets(ids.map((trackId) => ({ trackId, path: `/music/${trackId}.mp3` })));
  const artwork = createCollectionDraft(
    ids,
    ids.map((trackId) => ({ trackId, pictures: [], displayIndex: null, error: null })),
  );
  const request = {
    trackIds: ids,
    changes: [] as TagChange[],
    lyricsAction: "keep" as const,
    artwork,
  };
  async function add(path?: string) {
    await addPicture(
      artwork,
      Uint8Array.from([1, 2, 3]),
      "image/png",
      async () => new ArrayBuffer(0),
      3,
      path,
    );
  }
  return { save, request, saves, synchronized, editing, add };
}

describe("manual metadata save", () => {
  it("preserves reported successes and every failed target after a request error", async () => {
    const calls: number[][] = [];
    const { save, request, synchronized } = fixture({
      save: async (ids, _changes, progress) => {
        calls.push(ids);
        if (calls.length === 1) {
          progress(result(1));
          throw new Error("interrupted");
        }
        return ids.map((id) => result(id));
      },
    });
    request.changes = [{ field: "album", value: "New Album" }];
    expect(await save.run(request)).toEqual({ failed: true, hasError: true });
    expect(save.state.results.map(({ databaseUpdated }) => databaseUpdated)).toEqual([true, false]);
    expect(synchronized).toEqual([[1]]);
    expect(calls).toEqual([[1, 2]]);
    expect(save.state.results[1]?.error).toBe("interrupted");
    await save.run(request);
    expect(calls).toEqual([[1, 2], [2]]);
    expect(save.state.results.map(({ databaseUpdated }) => databaseUpdated)).toEqual([true, true]);
  });

  it("releases every mark target but not unmarking targets", async () => {
    const { save, request, editing, saves } = fixture();
    await save.run({ ...request, lyricsAction: "mark" });
    expect(editing).toEqual([[1, 2]]);
    expect(saves[0]?.changes).toEqual([]);
    save.reset();
    save.setTargets([1, 2].map((trackId) => ({ trackId, path: `/music/${trackId}.mp3` })));
    await save.run({ ...request, lyricsAction: "unmark" });
    expect(editing).toEqual([[1, 2]]);
  });

  it("retains per-target results after interruption, reloads saved new pictures, and retries only failed targets", async () => {
    const calls: number[][] = [];
    const drafts: ArtworkDraft[][] = [];
    const persisted = new Set<number>();
    let failRefresh = true;
    const { save, request, editing, add } = fixture({
      loadCollections: async (ids) =>
        ids.map((trackId) => ({
          trackId,
          pictures: persisted.has(trackId)
            ? [
                {
                  contentId: "persisted",
                  mimeType: "image/png",
                  byteLength: 3,
                  pictureType: 3,
                  artworkId: trackId * 10,
                  source: "embedded",
                  path: "",
                  error: null,
                },
              ]
            : [],
          displayIndex: persisted.has(trackId) ? 0 : null,
          error: null,
        })),
      save: async (ids, _changes, progress, _action, _operation, artwork) => {
        calls.push([...ids]);
        drafts.push(artwork);
        if (calls.length === 1) {
          persisted.add(1);
          progress(result(1));
          throw new Error("interrupted after first write");
        }
        ids.forEach((id) => persisted.add(id));
        return ids.map((id) => result(id));
      },
      synchronize: async () => {
        if (failRefresh) throw new Error("refresh failed");
      },
    });
    await add();
    await save.run(request);
    expect(save.state.results.map(({ databaseUpdated }) => databaseUpdated)).toEqual([true, false]);
    expect(save.state.results[1]?.error).toContain("interrupted");
    expect(request.artwork.tracks[0]?.pictures[0]?.picture).toEqual({
      source: "existing",
      artworkId: 10,
      pictureType: 3,
    });
    expect(request.artwork.tracks[1]?.pictures[0]?.picture.source).toBe("embedded");
    await save.run(request);
    expect(calls).toEqual([[1, 2], [2]]);
    expect(editing).toEqual([[1, 2], [2]]);
    expect(drafts[1]?.map(({ trackId }) => trackId)).toEqual([2]);
    expect(save.state.results.map(({ databaseUpdated }) => databaseUpdated)).toEqual([true, true]);
    expect(save.state.synchronizationError).toContain("refresh failed");
    failRefresh = false;
    expect(await save.retrySynchronization(request.artwork)).toEqual({
      failed: false,
      hasError: false,
    });
    expect(calls).toEqual([[1, 2], [2]]);
    expect(save.state.results).toHaveLength(2);
  });

  it("retries collection refresh without repeating a completed file write or losing outcomes", async () => {
    let failReload = true;
    let saves = 0;
    const { save, request, editing } = fixture(
      {
        loadCollections: async (ids) => {
          if (failReload) throw new Error("artwork refresh failed");
          return collections(ids);
        },
        save: async (ids) => {
          saves++;
          return ids.map((id) => result(id));
        },
      },
      [1],
    );
    request.artwork = createCollectionDraft([1], collections([1]));
    changePictureType(request.artwork, "common", 5);
    expect(await save.run(request)).toEqual({ failed: false, hasError: true });
    expect(save.state.results[0]?.databaseUpdated).toBe(true);
    expect(save.state.results[0]?.fileWritten).toBe(true);
    expect(save.state.error).toContain("artwork refresh failed");
    expect(request.artwork.tracks[0]?.error).toContain("artwork refresh failed");
    expect(request.artwork.tracks[0]?.original.pictures).toEqual(
      request.artwork.tracks[0]?.pictures,
    );
    expect(await save.retrySynchronization(request.artwork)).toEqual({
      failed: false,
      hasError: true,
    });
    failReload = false;
    expect(await save.retrySynchronization(request.artwork)).toEqual({
      failed: false,
      hasError: false,
    });
    expect(request.artwork.tracks[0]?.error).toBeNull();
    expect(saves).toBe(1);
    expect(editing).toEqual([[1]]);
    expect(save.state.results[0]?.databaseUpdated).toBe(true);
  });

  it("retains successful collection reloads and retries only failed descriptors", async () => {
    const reads: number[][] = [];
    const { save, request, saves, add } = fixture({
      loadCollections: async (ids) => {
        reads.push(ids);
        return collections(ids).map((collection) =>
          reads.length === 1 && collection.trackId === 2
            ? { ...collection, error: "descriptor failed" }
            : collection,
        );
      },
    });
    await add();
    await save.run(request);
    expect(save.state.results.map(({ databaseUpdated }) => databaseUpdated)).toEqual([true, true]);
    expect(request.artwork.tracks[0]?.error).toBeNull();
    expect(request.artwork.tracks[0]?.pictures[0]?.picture.source).toBe("existing");
    expect(request.artwork.tracks[1]?.error).toBe("descriptor failed");
    expect(save.state.error).toBe("descriptor failed");
    await save.retrySynchronization(request.artwork);
    expect(reads).toEqual([[1, 2], [2]]);
    expect(request.artwork.tracks.every(({ error }) => error === null)).toBe(true);
    expect(save.state.error).toBe("");
    expect(saves).toHaveLength(1);
  });

  it("reads the plan before acquiring a lease and guards only the real write IDs", async () => {
    let leased = false;
    let planned = false;
    const editing: number[][] = [];
    const { save, request, add } = fixture({
      planArtwork: async (drafts) => {
        expect(leased).toBe(false);
        planned = true;
        return drafts.map(({ trackId }) => ({
          trackId,
          fileWriteRequired: trackId === 2,
          error: null,
        }));
      },
      editFiles: async (ids, execute) => {
        expect(planned).toBe(true);
        editing.push([...ids]);
        leased = true;
        try {
          return await execute();
        } finally {
          leased = false;
        }
      },
      save: async (ids) => {
        expect(leased).toBe(true);
        expect(ids).toEqual([1, 2]);
        return ids.map((id) => ({ ...result(id), fileWritten: id === 2 }));
      },
    });
    await add();
    await save.run(request);
    expect(editing).toEqual([[2]]);
    expect(
      save.state.results.map(({ databaseUpdated, fileWritten }) => ({
        databaseUpdated,
        fileWritten,
      })),
    ).toEqual([
      { databaseUpdated: true, fileWritten: false },
      { databaseUpdated: true, fileWritten: true },
    ]);
  });

  it("applies linked additions to every target without guarding playback or embedding the bytes", async () => {
    const requests: ArtworkDraft[][] = [];
    const { save, request, add } = fixture({
      planArtwork: async (drafts) =>
        drafts.map(({ trackId }) => ({ trackId, fileWriteRequired: false, error: null })),
      editFiles: () => {
        throw new Error("DB-only artwork must not release playback");
      },
      save: async (ids, _changes, _progress, _action, _operation, drafts) => {
        requests.push(drafts);
        return ids.map((id) => ({ ...result(id), fileWritten: false }));
      },
    });
    await add("D:/cover.png");
    await save.run(request);
    expect(requests[0]).toEqual(
      [1, 2].map((trackId) => ({
        trackId,
        pictures: [{ source: "linked", path: "D:/cover.png", pictureType: 3 }],
        displayIndex: 0,
      })),
    );
    expect(save.state.results.every(({ databaseUpdated }) => databaseUpdated)).toBe(true);
  });

  it("retains every plan failure and saves only successfully planned targets", async () => {
    const { save, request, saves, editing, add } = fixture(
      {
        planArtwork: async () => [
          { trackId: 1, fileWriteRequired: false, error: "audio unavailable" },
          { trackId: 2, fileWriteRequired: true, error: null },
        ],
      },
      [1, 2, 3],
    );
    await add();
    expect(await save.run(request)).toEqual({ failed: true, hasError: false });
    expect(saves.map(({ ids }) => ids)).toEqual([[2]]);
    expect(editing).toEqual([[2]]);
    const outcomes = save.state.results
      .slice()
      .sort((left, right) => Number(left.trackId) - Number(right.trackId));
    expect(outcomes.map(({ databaseUpdated }) => databaseUpdated)).toEqual([false, true, false]);
    expect(outcomes[0]?.error).toBe("audio unavailable");
    expect(outcomes[2]?.error).toContain("写入计划无效");
    expect(
      request.artwork.tracks
        .filter(({ trackId }) => trackId !== 2)
        .every(({ pictures }) => pictures[0]?.picture.source === "embedded"),
    ).toBe(true);
  });

  it("never saves or acquires a lease after a rejected planning request", async () => {
    const { save, request, saves, add } = fixture({
      planArtwork: async () => {
        throw new Error("plan failed");
      },
      editFiles: () => {
        throw new Error("must not guard");
      },
    });
    await add();
    await save.run(request);
    expect(saves).toEqual([]);
    expect(
      save.state.results.map(({ error, databaseUpdated }) => ({ error, databaseUpdated })),
    ).toEqual([
      { error: "plan failed", databaseUpdated: false },
      { error: "plan failed", databaseUpdated: false },
    ]);
    expect(request.artwork.tracks.every(({ pictures }) => pictures.length === 1)).toBe(true);
  });

  it("retries only DB-failed targets, replans without another file lease, and retains fileWritten", async () => {
    const calls: number[][] = [];
    const plans: number[][] = [];
    const { save, request, editing, add } = fixture({
      planArtwork: async (drafts) => {
        plans.push(drafts.map(({ trackId }) => trackId));
        return drafts.map(({ trackId }) => ({
          trackId,
          fileWriteRequired: plans.length === 1,
          error: null,
        }));
      },
      save: async (ids) => {
        calls.push([...ids]);
        return ids.map((id) =>
          calls.length === 1 && id === 2
            ? { ...result(id, false), fileWritten: true, error: "database failed" }
            : { ...result(id), fileWritten: calls.length === 1 },
        );
      },
    });
    await add();
    await save.run(request);
    expect(
      save.state.results.map(({ fileWritten, databaseUpdated }) => ({
        fileWritten,
        databaseUpdated,
      })),
    ).toEqual([
      { fileWritten: true, databaseUpdated: true },
      { fileWritten: true, databaseUpdated: false },
    ]);
    expect(request.artwork.tracks[1]?.pictures[0]?.picture.source).toBe("embedded");
    await save.run(request);
    expect(plans).toEqual([[1, 2], [2]]);
    expect(calls).toEqual([[1, 2], [2]]);
    expect(editing).toEqual([[1, 2]]);
    expect(
      save.state.results.map(({ fileWritten, databaseUpdated }) => ({
        fileWritten,
        databaseUpdated,
      })),
    ).toEqual([
      { fileWritten: true, databaseUpdated: true },
      { fileWritten: true, databaseUpdated: true },
    ]);
  });

  it("holds the saving gate across collection reload and synchronization retry", async () => {
    let finish: (collections: ArtworkCollection[]) => void = () => {};
    let fail = true;
    const order: string[] = [];
    const { save, request, saves, add } = fixture({
      loadCollections: async () => {
        order.push("artwork");
        if (fail) throw new Error("reload failed");
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      synchronize: async () => {
        order.push("synchronize");
        if (fail) throw new Error("refresh failed");
      },
    });
    await add();
    await save.run(request);
    expect(order).toEqual(["synchronize", "artwork"]);
    fail = false;
    const retry = save.retrySynchronization(request.artwork);
    expect(save.state.saving).toBe(true);
    await save.run(request);
    expect(saves).toHaveLength(1);
    finish(collections([1, 2]));
    await retry;
    expect(order).toEqual(["synchronize", "artwork", "artwork", "synchronize"]);
    expect(save.state.saving).toBe(false);
    expect(save.state.results.map(({ databaseUpdated }) => databaseUpdated)).toEqual([true, true]);
  });

  it("clears saved outcomes and both refresh retries before switching editing targets", async () => {
    let fail = true;
    const reads: number[][] = [];
    const refreshed: number[][] = [];
    const { save, request, saves, add } = fixture(
      {
        loadCollections: async (ids) => {
          reads.push(ids);
          if (fail) throw new Error("artwork refresh failed");
          return collections(ids);
        },
        synchronize: async (ids) => {
          refreshed.push(ids);
          if (fail) throw new Error("refresh failed");
        },
      },
      [1],
    );
    save.setTargets([{ trackId: 1, path: "/music/1.mp3" }]);
    await add();
    expect(await save.run(request)).toEqual({ failed: false, hasError: true });
    expect(save.state.results[0]?.databaseUpdated).toBe(true);
    expect(save.state.error).toContain("artwork refresh failed");
    expect(save.state.synchronizationError).toContain("refresh failed");

    save.reset();
    save.setTargets([{ trackId: 2, path: "/music/2.mp3" }]);
    const artwork = createCollectionDraft([2], collections([2]));
    fail = false;
    expect(save.state.results).toEqual([]);
    expect(save.remainingIds([1, 2])).toEqual([1, 2]);
    expect(await save.retrySynchronization(artwork)).toEqual({ failed: false, hasError: false });
    expect(reads).toEqual([[1]]);
    expect(refreshed).toEqual([[1]]);
    expect(artwork).toEqual(createCollectionDraft([2], collections([2])));

    await save.run({
      trackIds: [2],
      changes: [{ field: "title", value: "New target" }],
      lyricsAction: "keep",
      artwork,
    });
    expect(saves.map(({ ids }) => ids)).toEqual([[1], [2]]);
    expect(saves[1]?.artwork).toEqual([]);
    expect(
      save.state.results.map(({ trackId, databaseUpdated }) => ({ trackId, databaseUpdated })),
    ).toEqual([{ trackId: 2, databaseUpdated: true }]);
    expect(reads).toEqual([[1]]);
    expect(refreshed).toEqual([[1], [2]]);
  });
});
