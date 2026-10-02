// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, describe, expect, it } from "bun:test";
import { ref } from "vue";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { OpenDialogOptions } from "@tauri-apps/plugin-dialog";
import type { NotificationInput } from "@/notification/center";
import type { useLibraryFileImport } from "@/library/fileImport";
import { LIBRARY_SCAN_COMPLETED_EVENT, type LibraryScanResult } from "@/library/scan";

const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const output = transpileModule(
  await bunRuntime.Bun.file(new URL("../src/library/fileImport.ts", import.meta.url)).text(),
  { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } },
).outputText;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
const result: LibraryScanResult = { added: 2, updated: 1, skipped: 0, failed: 0 };
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
  const events: string[] = [];
  const notices: NotificationInput[] = [];
  const calls: Array<[string, unknown]> = [];
  const pickerOptions: OpenDialogOptions[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: (event: Event) => events.push(event.type) },
  });
  const modules: Record<string, unknown> = {
    vue: { ref },
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
    "@/library/scan": { LIBRARY_SCAN_COMPLETED_EVENT },
    "@/notification/center": { notify: (notice: NotificationInput) => notices.push(notice) },
  };
  const module = { exports: {} as { useLibraryFileImport: typeof useLibraryFileImport } };
  new Function("require", "module", "exports", output)(
    (name: string) => modules[name],
    module,
    module.exports,
  );
  return {
    ...module.exports.useLibraryFileImport(),
    factory: module.exports.useLibraryFileImport,
    events,
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
      ["import_music_files", { paths: ["C:\\Music\\one.mp3", "D:\\Music\\two.flac"] }],
    ]);
    expect(importer.notices[0]).toMatchObject({
      type: "success",
      message: "导入完成：新增 2，更新 1，跳过 0，读取失败 0",
    });
    expect(importer.events).toEqual([LIBRARY_SCAN_COMPLETED_EVENT]);
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
    expect(importer.calls[1]).toEqual(["import_music_files", { paths: ["/Music/song.wav"] }]);
  });

  it("reports partial failures and still refreshes successfully imported tracks", async () => {
    const importer = createImport({
      invoke: async (command) =>
        command === "supported_audio_extensions" ? extensions : { ...result, failed: 1 },
    });
    await importer.importMusicFiles();
    expect(importer.notices[0]?.type).toBe("warning");
    expect(importer.notices[0]?.message).toContain("读取失败 1");
    expect(importer.events).toEqual([LIBRARY_SCAN_COMPLETED_EVENT]);
  });

  it("blocks concurrent pickers and imports across composable instances", async () => {
    const selection = deferred<string[]>();
    const completion = deferred<LibraryScanResult>();
    const importer = createImport({
      pick: () => selection.promise,
      invoke: async (command) =>
        command === "supported_audio_extensions" ? extensions : completion.promise,
    });
    const pending = importer.importMusicFiles();
    await importer.factory().importMusicFiles();
    expect(importer.calls).toHaveLength(1);
    expect(importer.isImporting.value).toBe(true);
    selection.resolve(["/Music/song.wav"]);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    await importer.factory().importMusicFiles();
    expect(importer.calls).toHaveLength(2);
    expect(importer.pickerOptions).toHaveLength(1);
    completion.resolve(result);
    await pending;
    expect(importer.isImporting.value).toBe(false);
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
