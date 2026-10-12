import { expect, it } from "bun:test";
import { evaluateSource, transpileScript } from "../../../support/module/loader";
import type * as Api from "@/features/artwork/artist/api";

const source = await Bun.file("src/features/artwork/artist/api.ts").text();

it("opens Google image search with the exact artist name and no image download", async () => {
  const opened: string[] = [];
  const commands: string[] = [];
  const api = evaluateSource<typeof Api>(transpileScript(source), {
    "@tauri-apps/api/core": { invoke: async (command: string) => commands.push(command) },
    "@tauri-apps/plugin-opener": {
      openUrl: async (url: string) => {
        opened.push(url);
      },
    },
  });
  const artist = "A & B / 演出者 + #1";
  await api.searchArtistPhoto(artist);
  const url = new URL(opened[0]);
  expect(url.origin + url.pathname).toBe("https://www.google.com/search");
  expect(url.searchParams.get("tbm")).toBe("isch");
  expect(url.searchParams.get("q")).toBe(artist);
  expect(commands).toEqual([]);
});

it("uses the same exact artist identity for reading and replacing photos", async () => {
  const requests: Array<{ command: string; args: unknown }> = [];
  const content = new Uint8Array([1, 2, 3]).buffer;
  const api = evaluateSource<typeof Api>(transpileScript(source), {
    "@tauri-apps/api/core": {
      invoke: async (command: string, args: unknown) => {
        requests.push({ command, args });
        return command === "get_artist_photo"
          ? content
          : command === "find_artist_photo"
            ? true
            : undefined;
      },
    },
    "@tauri-apps/plugin-opener": { openUrl: async () => {} },
  });
  expect(await api.readArtistPhoto("Artist")).toBe(content);
  expect(await api.findArtistPhoto("Artist")).toBe(true);
  await api.saveArtistPhoto("Artist", [4, 5, 6]);
  expect(requests).toEqual([
    { command: "get_artist_photo", args: { artist: "Artist" } },
    { command: "find_artist_photo", args: { artist: "Artist" } },
    { command: "save_artist_photo", args: { artist: "Artist", data: [4, 5, 6] } },
  ]);
});
