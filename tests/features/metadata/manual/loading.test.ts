import { describe, expect, it } from "bun:test";
import { createManualLoading } from "@/features/metadata/manual/loading";
import type { EditableTrack, MetadataTarget } from "@/features/metadata/types";
import type { TrackRegistrationResult } from "@/features/tracks/types";

function snapshot(id: MetadataTarget, path: string): EditableTrack {
  return {
    track: {
      id,
      path,
      title: "File title",
      artist: null,
      album: null,
      albumArtist: null,
      releaseDate: null,
      discNumber: null,
      trackNumber: null,
      discTotal: null,
      trackTotal: null,
      durationMs: 1000,
      codec: "MP3",
      sampleRateHz: null,
      bitrateKbps: null,
      channels: null,
    },
    lyrics: "File lyrics",
    noLyrics: false,
    writableFields: ["title", "lyrics"],
    issue: null,
    values: { label: "File label" },
  };
}
function registered(id: number, path: string): TrackRegistrationResult {
  return {
    status: "registered",
    track: { ...snapshot(id, path).track, id, title: "Registration title" },
    needsMetadata: true,
  };
}

describe("manual target loading", () => {
  it("reads file editing snapshots before registration and maps by exact path rather than response order", async () => {
    const calls: string[] = [];
    const load = createManualLoading(
      {
        editableTracks: async (paths) => {
          calls.push("files");
          expect(paths).toEqual(["/a.mp3", "/b.mp3"]);
          return [snapshot("/a.mp3", "/a.mp3"), snapshot("/b.mp3", "/b.mp3")];
        },
      },
      {
        registerLocalFiles: async (paths) => {
          calls.push("register");
          expect(paths).toEqual(["/a.mp3", "/b.mp3"]);
          return [registered(12, "/b.mp3"), registered(11, "/a.mp3")];
        },
      },
    );
    const tracks = await load(["/a.mp3", "/b.mp3"]);
    expect(calls).toEqual(["files", "register"]);
    expect(tracks.map(({ track }) => track.id)).toEqual([11, 12]);
    expect(tracks.map(({ track }) => track.title)).toEqual(["File title", "File title"]);
    expect(tracks[0]?.lyrics).toBe("File lyrics");
    expect(tracks[0]?.values).toEqual({ label: "File label" });
  });

  it("loads existing numeric targets without registering or reading file snapshots", async () => {
    const load = createManualLoading(
      {
        editableTracks: async (ids) => {
          expect(ids).toEqual([11]);
          return [snapshot(11, "/a.mp3")];
        },
      },
      {
        registerLocalFiles: async () => {
          throw new Error("Unexpected registration");
        },
      },
    );
    expect((await load([11]))[0]?.track.id).toBe(11);
    await expect(load([11, "/a.mp3"])).rejects.toThrow("不匹配");
  });

  for (const results of [
    [],
    [registered(11, "/other.mp3")],
    [registered(0, "/a.mp3")],
    [registered(1.5, "/a.mp3")],
    [registered(11, "/a.mp3"), registered(12, "/a.mp3")],
    [registered(11, "/a.mp3"), registered(11, "/b.mp3")],
  ]) {
    it(`rejects mismatched registration ${JSON.stringify(results)}`, async () => {
      const paths = results.length === 2 ? ["/a.mp3", "/b.mp3"] : ["/a.mp3"];
      const load = createManualLoading(
        { editableTracks: async () => paths.map((path) => snapshot(path, path)) },
        { registerLocalFiles: async () => results },
      );
      await expect(load(paths)).rejects.toThrow("不匹配");
    });
  }

  it("rejects invalid file snapshots before registering and propagates registration failures", async () => {
    let registrationCalls = 0;
    const tracks = {
      registerLocalFiles: async (): Promise<TrackRegistrationResult[]> => {
        registrationCalls++;
        return [{ status: "failed", path: "/a.mp3", error: "Registration failed" }];
      },
    };
    for (const snapshots of [
      [],
      [snapshot("/other.mp3", "/other.mp3")],
      [snapshot(11, "/a.mp3")],
    ]) {
      const load = createManualLoading({ editableTracks: async () => snapshots }, tracks);
      await expect(load(["/a.mp3"])).rejects.toThrow("不匹配");
    }
    expect(registrationCalls).toBe(0);
    const load = createManualLoading(
      { editableTracks: async () => [snapshot("/a.mp3", "/a.mp3")] },
      tracks,
    );
    await expect(load(["/a.mp3"])).rejects.toThrow("Registration failed");
  });
});
