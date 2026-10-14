import { describe, expect, it } from "bun:test";
import { evaluateSource, transpileScript } from "../../support/module/loader";

const source = await Bun.file("src/features/artwork/transfer.ts").text();
function load(
  response: (command: string, args: Record<string, unknown> | undefined) => unknown,
  choose: (options: Record<string, unknown>) => Promise<string | null> = async () => null,
) {
  const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  const dialogs: Record<string, unknown>[] = [];
  const api = evaluateSource<typeof import("@/features/artwork/transfer")>(
    transpileScript(source),
    {
      "@tauri-apps/api/core": {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return response(command, args);
        },
      },
      "@tauri-apps/plugin-dialog": {
        open: async (options: Record<string, unknown>) => {
          dialogs.push(options);
          return choose(options);
        },
        save: async (options: Record<string, unknown>) => {
          dialogs.push(options);
          return choose(options);
        },
      },
    },
  );
  return { api, calls, dialogs };
}

describe("cover transfer", () => {
  it("checks and reads clipboard content through typed native commands", async () => {
    const { api, calls } = load((command) =>
      command === "has_clipboard_artwork" ? true : new Uint8Array([1, 2]).buffer,
    );
    expect(await api.hasClipboardCover()).toBe(true);
    expect(await api.readClipboardCover()).toEqual([1, 2]);
    expect(calls.map(({ command }) => command)).toEqual([
      "has_clipboard_artwork",
      "read_clipboard_artwork",
    ]);
  });

  it("requests original artwork without a thumbnail size", async () => {
    const { api, calls } = load(() => new Uint8Array([3, 4]).buffer);
    expect(await api.readOriginalCover(17)).toEqual([3, 4]);
    expect(calls).toEqual([{ command: "get_track_artwork", args: { trackId: 17, size: null } }]);
  });

  it("detects import MIME from original bytes through the backend", async () => {
    for (const [extension, mime] of [
      ["jpg", "image/jpeg"],
      ["png", "image/png"],
      ["webp", "image/webp"],
      ["gif", "image/gif"],
      ["tif", "image/tiff"],
      ["ico", "image/x-icon"],
    ]) {
      const { api, calls } = load(() => [extension]);
      expect(await api.pictureMimeType([0, 255, 3])).toBe(mime);
      expect(calls).toEqual([{ command: "artwork_extensions", args: { data: [0, 255, 3] } }]);
    }
    const unknown = load(() => ["unknown"]);
    await expect(unknown.api.pictureMimeType([1])).rejects.toThrow("无法识别图片格式");
    const failed = load(() => {
      throw new Error("invalid bytes");
    });
    await expect(failed.api.pictureMimeType([1])).rejects.toThrow("invalid bytes");
  });

  it("exports unchanged bytes with detected format and a save dialog", async () => {
    const data = [1, 2, 3];
    const { api, calls, dialogs } = load(
      (command) => (command === "artwork_extensions" ? ["jpg", "jpeg"] : undefined),
      async () => "D:/cover.jpg",
    );
    expect(await api.saveCover(data, () => true)).toBe("D:/cover.jpg");
    expect(dialogs).toEqual([
      {
        title: "保存封面",
        defaultPath: "cover.jpg",
        filters: [{ name: "封面", extensions: ["jpg", "jpeg"] }],
      },
    ]);
    expect(calls).toEqual([
      { command: "artwork_extensions", args: { data } },
      { command: "save_artwork", args: { path: "D:/cover.jpg", data } },
    ]);
  });

  it("does not write when the dialog is cancelled", async () => {
    const { api, calls } = load(() => ["png"]);
    await api.saveCover([1], () => true);
    expect(calls.map(({ command }) => command)).toEqual(["artwork_extensions"]);
  });

  it("does not open a dialog after the source becomes obsolete", async () => {
    const { api, dialogs } = load(() => ["png"]);
    await api.saveCover([1], () => false);
    expect(dialogs).toEqual([]);
  });

  it("does not write when the source changes while choosing a path", async () => {
    let current = true;
    const { api, calls } = load(
      () => ["png"],
      async () => {
        current = false;
        return "D:/cover.png";
      },
    );
    await api.saveCover([1], () => current);
    expect(calls.map(({ command }) => command)).toEqual(["artwork_extensions"]);
  });

  it("propagates format, dialog and write errors", async () => {
    const error = new Error("transfer failed");
    const failures = [
      load(() => {
        throw error;
      }),
      load(
        () => ["png"],
        async () => {
          throw error;
        },
      ),
      load(
        (command) => {
          if (command === "save_artwork") throw error;
          return ["png"];
        },
        async () => "D:/cover.png",
      ),
    ];
    for (const { api } of failures)
      await expect(api.saveCover([1], () => true)).rejects.toBe(error);
  });
  it("selects the actual native path and validates/reads its bytes on the backend", async () => {
    const { api, calls, dialogs } = load(
      () => [9, 8],
      async () => "D:/actual.png",
    );
    const selected = await api.selectCover();
    expect(selected?.path).toBe("D:/actual.png");
    expect(Array.from(selected?.data ?? [])).toEqual([9, 8]);
    expect(calls).toEqual([{ command: "read_artwork_file", args: { path: "D:/actual.png" } }]);
    expect(dialogs).toEqual([{ title: "添加图片", multiple: false, directory: false }]);
    const cancelled = load(() => {
      throw new Error("must not read");
    });
    expect(await cancelled.api.selectCover()).toBeNull();
    expect(cancelled.calls).toEqual([]);
    const failed = load(
      () => {
        throw new Error("invalid image");
      },
      async () => "D:/invalid.png",
    );
    await expect(failed.api.selectCover()).rejects.toThrow("invalid image");
  });
});
