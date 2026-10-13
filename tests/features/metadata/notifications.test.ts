import type { MetadataTarget } from "@/features/metadata/types";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { notifications } from "@/shared/notifications/center";
import { setLocale } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { createMetadataSave } from "@/features/metadata/save";
import { createTagEditor } from "@/features/metadata/manual/useEditor";
import { createReleaseEditor } from "@/features/metadata/releases/useEditor";
import type { ReleaseEditorOptions } from "@/features/metadata/releases/useEditor";
import type { MetadataSaveResult } from "@/features/metadata/types";
import { album, local, release } from "./releases/fixtures";

const settle = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
};
afterEach(() => {
  setLocale("zh-CN");
  notifications.clear();
});

function result(trackId: MetadataTarget, databaseUpdated = true): MetadataSaveResult {
  return {
    trackId,
    path: `/music/${trackId}.flac`,
    fileWritten: true,
    databaseUpdated,
    error: databaseUpdated ? null : "database failed for /music/private.flac",
  };
}
function releaseEditor(overrides: Partial<ReleaseEditorOptions> = {}) {
  return createReleaseEditor({
    loadAlbum: async () => [local(1), local(2)],
    search: async () => ({ count: 0, offset: 0, releases: [] }),
    release: async () => release(),
    covers: async () => [],
    cover: async () => ({ mimeType: "image/png", data: [] }),
    save: async (patches) => patches.map(({ trackId }) => result(trackId)),
    editFiles: (_ids, save) => save(),
    synchronize: async () => {},
    ...overrides,
  });
}

describe("tag business notifications", () => {
  it("uses the current locale for save summaries, counts and refresh errors at operation time", async () => {
    const save = createMetadataSave({
      notifyResult: true,
      editFiles: (_ids, execute) => execute(),
      synchronize: async () => {
        throw new Error("refresh failed");
      },
    });
    setLocale("en");
    const saved = await save.run({
      targets: [1, 2].map((trackId) => ({ trackId, path: `/music/${trackId}.flac` })),
      writeTrackIds: [1, 2],
      execute: async () => [result(1), result(2, false)],
    });
    expect(notifications.items.value[0]?.message).toBe(
      "Tags saved: 1 succeeded, 1 failed. Metadata saved, but the interface could not be refreshed.",
    );
    expect(save.state.synchronizationError).toBe(
      "Metadata saved, but the interface could not be refreshed: refresh failed",
    );
    expect(saved[0]?.databaseUpdated).toBe(true);
    expect(saved[1]?.databaseUpdated).toBe(false);
    expect(saved[1]?.error).toBe("database failed for /music/private.flac");
  });
  for (const outcome of ["success", "failure", "interrupted"] as const) {
    it(`notifies exactly one summary for ${outcome}, retaining results and logging details`, async () => {
      notifications.clear();
      const log = spyOn(logger, "write");
      try {
        const save = createMetadataSave({
          notifyResult: true,
          editFiles: (_ids, execute) => execute(),
          synchronize: async () => {
            if (outcome === "interrupted") throw new Error("refresh failed");
          },
        });
        const first = result(1, outcome !== "failure");
        const saved = await save.run({
          targets: [1, 2].map((trackId) => ({ trackId, path: `/music/${trackId}.flac` })),
          writeTrackIds: [1, 2],
          execute: async (progress) => {
            progress(first);
            if (outcome === "interrupted") throw new Error("request failed");
            return [first, result(2, outcome === "success")];
          },
        });
        expect(saved).toHaveLength(2);
        expect(save.state.results).toEqual(saved);
        expect(saved[0]).toEqual(first);
        expect(saved[1]?.databaseUpdated).toBe(outcome === "success");
        expect(notifications.items.value).toHaveLength(1);
        const notification = notifications.items.value[0];
        expect(notification?.message).toContain(
          outcome === "success"
            ? "2 首成功，0 首失败"
            : outcome === "failure"
              ? "0 首成功，2 首失败"
              : "1 首成功，1 首失败",
        );
        expect(notification?.type).toBe(
          outcome === "success" ? "success" : outcome === "failure" ? "error" : "warning",
        );
        expect(notification?.message).not.toContain("/music/");
        expect(notification?.message).not.toContain("request failed");
        if (outcome === "interrupted") {
          expect(notification?.message).toContain("界面刷新失败");
          expect(saved[1]?.error).toBe("request failed");
          expect(save.state.synchronizationError).toContain("refresh failed");
        }
        expect(log.mock.calls.filter((call) => call[2] === "save_result")).toHaveLength(2);
        expect(log.mock.calls.some((call) => call[3]?.path === first.path)).toBe(true);
      } finally {
        log.mockRestore();
      }
    });
  }

  it("does not add tag notifications to other consumers of metadata save", async () => {
    notifications.clear();
    const save = createMetadataSave({
      editFiles: (_ids, execute) => execute(),
      synchronize: () => {},
    });
    await save.run({
      targets: [{ trackId: 1, path: "/music/1.flac" }],
      writeTrackIds: [],
      execute: async () => [result(1)],
    });
    expect(notifications.items.value).toHaveLength(0);
  });

  it("notifies and logs manual editor loading failures without a component watcher", async () => {
    notifications.clear();
    const error = new Error("read failed");
    const log = spyOn(logger, "error");
    try {
      const editor = createTagEditor({
        loadTracks: async () => {
          throw error;
        },
        loadCollections: async (ids) =>
          ids.map((trackId) => ({
            trackId,
            pictures: [],
            displayIndex: null,
            error: null,
          })),
        readArtwork: async () => {
          throw new Error("No artwork in this fixture");
        },
        loadAlbum: async () => [],
        save: async () => [],
        editFiles: (_ids, execute) => execute(),
        synchronize: async () => {},
      });
      await editor.openTracks([1]);
      expect(editor.state.error).toBe("read failed");
      expect(notifications.items.value).toHaveLength(1);
      expect(notifications.items.value[0]?.message).toBe("读取标签失败，请查看日志");
      expect(log).toHaveBeenCalledWith("metadata", "editor_load_failed", error);
    } finally {
      log.mockRestore();
    }
  });

  it("reports release count and cover errors at operation boundaries and removes retry entries", async () => {
    notifications.clear();
    const editor = releaseEditor({
      covers: async () => {
        throw new Error("cover network failed");
      },
    });
    await editor.open(album);
    editor.selectRelease(release().summary.id);
    await settle();
    expect(
      notifications.items.value.filter(({ message }) => message.includes("数量不一致")),
    ).toHaveLength(1);
    expect(
      notifications.items.value.filter(({ message }) => message === "读取封面列表失败，请查看日志"),
    ).toHaveLength(1);
    expect(editor.state.coverError).toBe("cover network failed");
    expect("retryCovers" in editor).toBe(false);
    notifications.clear();
    editor.prepareSave();
    expect(editor.state.confirmSave).toBe(true);
    await editor.save();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.message).toContain("2 首成功，0 首失败");
  });

  it("does not notify missing covers when the empty cover state provides feedback", async () => {
    const editor = releaseEditor();
    await editor.open(album);
    editor.selectRelease(release().summary.id);
    await settle();
    expect(editor.state.coverError).toContain("没有正面封面");
    expect(notifications.items.value.filter(({ type }) => type === "info")).toHaveLength(0);
  });

  it("aggregates unavailable tracks and unsupported selected fields without changing patches", async () => {
    notifications.clear();
    const editor = releaseEditor({
      loadAlbum: async () => [
        { ...local(1), issue: "read failed" },
        { ...local(2), writableFields: [] },
      ],
    });
    await editor.open(album);
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.message).toContain("2 首曲目");
    editor.selectRelease(release().summary.id);
    await settle();
    notifications.clear();
    editor.prepareSave();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.message).toContain("不支持写入部分所选字段");
    expect(editor.state.patches.map(({ trackId }) => trackId)).toEqual([2]);
    expect(editor.state.confirmSave).toBe(true);
  });
});
