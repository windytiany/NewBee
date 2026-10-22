import { afterEach, describe, expect, it } from "bun:test";
import { ref } from "vue";
import { createTaskCenter } from "@/shared/tasks/state";
import { setLocale } from "@/shared/i18n/locale";
import { transpileScript, evaluateSource } from "../../../support/module/loader";

import type { OpenDialogOptions } from "@tauri-apps/plugin-dialog";
import type { NotificationInput } from "@/shared/notifications/center";
import type { useLibraryFileImport } from "@/features/library/import/useFileImport";
import type { IngestResult } from "@/features/library/types";
import type * as LibraryChanges from "@/features/library/events";

const LIBRARY_CHANGED_EVENT = "newbee:library-changed";

const output = transpileScript(
  await Bun.file(
    new URL("../../../../src/features/library/import/useFileImport.ts", import.meta.url),
  ).text(),
);
const changesOutput = transpileScript(
  await Bun.file(new URL("../../../../src/features/library/events.ts", import.meta.url)).text(),
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  setLocale("zh-CN");
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
const result: IngestResult = { added: 2, updated: 1, skipped: 0, failed: 0 };
const extensions = ["mp3", "aac", "m4a", "ogg", "oga", "flac", "wav"];

function createImport({
  pick = async () => ["C:\\Music\\one.mp3", "D:\\Music\\two.flac"],
  invoke = async (command) => (command === "supported_audio_extensions" ? extensions : result),
  desktop = true,
}: {
  pick?: (options: OpenDialogOptions) => Promise<string[] | null>;
  invoke?: (command: string, args?: unknown) => Promise<unknown>;
  desktop?: boolean;
} = {}) {
  const tasks = createTaskCenter();
  const events: string[] = [];
  const effects: string[] = [];
  const changes = evaluateSource<typeof LibraryChanges>(changesOutput, {
    "@/features/artwork/album/useArtwork": {
      invalidateAlbumArtworkCache: () => effects.push("albums"),
    },
    "@/features/artwork/track/useArtwork": {
      invalidateTrackArtworkCache: () => effects.push("artwork"),
    },
  });
  const notices: NotificationInput[] = [];
  const calls: Array<[string, unknown]> = [];
  const pickerOptions: OpenDialogOptions[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => {
        effects.push("refresh");
        events.push(event.type);
      },
    },
  });
  const modules: Record<string, unknown> = {
    vue: { ref },
    "@/shared/tasks/state": { tasks },
    "@tauri-apps/api/core": {
      isTauri: () => desktop,
      invoke: (command: string, args: unknown) => {
        calls.push([command, args]);
        return invoke(command, args);
      },
    },
    "@tauri-apps/plugin-dialog": {
      open: (options: OpenDialogOptions) => {
        pickerOptions.push(options);
        return pick(options);
      },
    },
    "@/features/library/events": changes,
    "@/shared/notifications/center": {
      notify: (notice: NotificationInput) => notices.push(notice),
    },
  };
  const { useLibraryFileImport: createImport } = evaluateSource<{
    useLibraryFileImport: typeof useLibraryFileImport;
  }>(output, modules);
  return {
    ...createImport(),
    tasks,
    factory: createImport,
    events,
    effects,
    notices,
    calls,
    pickerOptions,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("audio file import", () => {
  it("validates dropped paths without opening a picker and imports only readable files", async () => {
    const importer = createImport({
      invoke: async (command) =>
        command === "readable_audio_files" ? ["/Music/good.wav"] : result,
    });
    await importer.importPaths(["/Music/good.wav", "/Music/broken.mp3", "/Music/folder"]);
    expect(importer.pickerOptions).toEqual([]);
    expect(importer.calls.map(([command]) => command)).toEqual([
      "readable_audio_files",
      "import_music_files",
    ]);
    expect(importer.calls[1]?.[1]).toMatchObject({ paths: ["/Music/good.wav"] });
    expect(importer.events).toEqual(["newbee:tracks-changed", LIBRARY_CHANGED_EVENT]);
    expect(importer.notices[0]?.type).toBe("success");
  });

  it("silently ignores an entirely invalid drop", async () => {
    const importer = createImport({ invoke: async () => [] });
    await importer.importPaths(["/Music/broken.mp3"]);
    expect(importer.calls).toHaveLength(1);
    expect(importer.notices).toEqual([]);
    expect(importer.events).toEqual([]);
    expect(importer.isImporting.value).toBe(false);
  });

  it("holds the shared import lock while dropped files are being validated", async () => {
    const validation = deferred<string[]>();
    const importer = createImport({ invoke: () => validation.promise });
    const pending = importer.importPaths(["/Music/broken.mp3"]);
    await importer.factory().importMusicFiles();
    await importer.factory().importPaths(["/Music/other.wav"]);
    expect(importer.calls).toHaveLength(1);
    expect(importer.pickerOptions).toEqual([]);
    expect(importer.tasks.active.value).toHaveLength(1);
    validation.resolve([]);
    await pending;
    expect(importer.isImporting.value).toBe(false);
    expect(importer.tasks.active.value).toEqual([]);
  });

  it("reports system errors from a drop and releases the lock", async () => {
    const importer = createImport({
      invoke: async () => {
        throw new Error("task failed");
      },
    });
    await importer.importPaths(["/Music/song.wav"]);
    expect(importer.notices[0]?.type).toBe("error");
    expect(importer.isImporting.value).toBe(false);
    expect(importer.tasks.active.value).toEqual([]);
  });

  it("evaluates picker titles, filters, and count notifications in the current locale", async () => {
    const importer = createImport();
    setLocale("en");
    await importer.importMusicFiles();
    expect(importer.pickerOptions).toEqual([
      {
        title: "Import audio files",
        directory: false,
        multiple: true,
        filters: [{ name: "Supported audio files", extensions }],
      },
    ]);
    expect(importer.notices[0]).toMatchObject({
      type: "success",
      message: "Import complete: 2 tracks added, 1 updated",
    });
    expect(importer.calls[1]?.[0]).toBe("import_music_files");
    expect(importer.events).toEqual(["newbee:tracks-changed", LIBRARY_CHANGED_EVENT]);
  });

  it("uses backend-supported extensions, imports the selection, and refreshes the library", async () => {
    const importer = createImport();
    await importer.importMusicFiles();
    expect(importer.pickerOptions).toEqual([
      {
        title: "导入音频文件",
        directory: false,
        multiple: true,
        filters: [{ name: "支持的音频文件", extensions }],
      },
    ]);
    expect(importer.calls).toEqual([
      ["supported_audio_extensions", undefined],
      [
        "import_music_files",
        {
          operationId: expect.stringContaining("library-import:"),
          paths: ["C:\\Music\\one.mp3", "D:\\Music\\two.flac"],
        },
      ],
    ]);
    expect(importer.notices[0]).toMatchObject({
      type: "success",
      message: "导入完成：新增 2 首，更新 1 首",
    });
    expect(importer.events).toEqual(["newbee:tracks-changed", LIBRARY_CHANGED_EVENT]);
    expect(importer.effects).toEqual(["artwork", "albums", "refresh", "refresh"]);
    expect(importer.isImporting.value).toBe(false);
  });

  for (const selected of [null, []]) {
    it(`does not import or notify after ${selected === null ? "cancel" : "an empty selection"}`, async () => {
      const importer = createImport({ pick: async () => selected });
      await importer.importMusicFiles();
      expect(importer.calls).toEqual([["supported_audio_extensions", undefined]]);
      expect(importer.notices).toEqual([]);
      expect(importer.events).toEqual([]);
      expect(importer.isImporting.value).toBe(false);
    });
  }

  it("accepts a single selected path", async () => {
    const importer = createImport({ pick: async () => ["/Music/song.wav"] });
    await importer.importMusicFiles();
    expect(importer.calls[1]).toEqual([
      "import_music_files",
      { paths: ["/Music/song.wav"], operationId: expect.stringContaining("library-import:") },
    ]);
  });

  it("reports partial failures and still refreshes successfully imported tracks", async () => {
    const importer = createImport({
      invoke: async (command) =>
        command === "supported_audio_extensions" ? extensions : { ...result, failed: 1 },
    });
    await importer.importMusicFiles();
    expect(importer.notices[0]?.type).toBe("warning");
    expect(importer.notices[0]?.message).toContain("1 首失败");
    expect(importer.events).toEqual(["newbee:tracks-changed", LIBRARY_CHANGED_EVENT]);
  });

  it("keeps the completion notice but skips invalidation when nothing was written", async () => {
    const importer = createImport({
      invoke: async (command) =>
        command === "supported_audio_extensions"
          ? extensions
          : { added: 0, updated: 0, skipped: 2, failed: 1 },
    });
    await importer.importMusicFiles();
    expect(importer.notices[0]?.type).toBe("warning");
    expect(importer.events).toEqual([]);
    expect(importer.effects).toEqual([]);
  });

  it("blocks concurrent pickers but permits another submission after files are selected", async () => {
    const selection = deferred<string[]>();
    const completion = deferred<IngestResult>();
    const importer = createImport({
      pick: () => selection.promise,
      invoke: async (command) =>
        command === "supported_audio_extensions" ? extensions : completion.promise,
    });
    const pending = importer.importMusicFiles();
    await importer.factory().importMusicFiles();
    expect(importer.calls).toHaveLength(1);
    expect(importer.isImporting.value).toBe(true);
    expect(importer.tasks.active.value).toEqual([]);
    selection.resolve(["/Music/song.wav"]);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    const another = importer.factory().importMusicFiles();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    expect(importer.calls).toHaveLength(4);
    expect(importer.pickerOptions).toHaveLength(2);
    expect(importer.tasks.active.value).toHaveLength(2);
    completion.resolve(result);
    await Promise.all([pending, another]);
    expect(importer.isImporting.value).toBe(false);
    expect(importer.tasks.active.value).toEqual([]);
  });

  for (const stage of ["extensions", "picker", "import"]) {
    it(`reports ${stage} errors without refreshing and releases the pending state`, async () => {
      const importer = createImport({
        pick: async () => {
          if (stage === "picker") throw new Error("picker failed");
          return ["/Music/song.wav"];
        },
        invoke: async (command) => {
          if (
            (stage === "extensions" && command === "supported_audio_extensions") ||
            (stage === "import" && command === "import_music_files")
          )
            throw new Error("backend failed");
          return extensions;
        },
      });
      await importer.importMusicFiles();
      expect(importer.notices[0]?.type).toBe("error");
      expect(importer.events).toEqual([]);
      expect(importer.isImporting.value).toBe(false);
    });
  }

  it("does not access desktop APIs in browser preview", async () => {
    const importer = createImport({ desktop: false });
    await importer.importMusicFiles();
    expect(importer.calls).toEqual([]);
    expect(importer.pickerOptions).toEqual([]);
    expect(importer.notices).toEqual([]);
  });
});
