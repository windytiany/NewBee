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

  it("exports unchanged bytes with detected format and a save dialog", async () => {
    const data = [1, 2, 3];
    const { api, calls, dialogs } = load(
      (command) => (command === "artwork_extensions" ? ["jpg", "jpeg"] : undefined),
      async () => "D:/cover.jpg",
    );
    await api.saveCover(data, () => true);
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
});
