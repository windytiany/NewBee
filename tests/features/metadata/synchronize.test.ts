import { afterEach, describe, expect, it } from "bun:test";
import { evaluateSource, transpileScript } from "../../support/module/loader";
import type { TracksInvoker } from "@/features/tracks/api";
import type { TrackMetadataUpdate } from "@/features/playback/types";

const output = transpileScript(
  await Bun.file(new URL("../../../src/features/metadata/synchronize.ts", import.meta.url)).text(),
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function fixture() {
  const events: string[] = [];
  const updates: Array<readonly TrackMetadataUpdate[]> = [];
  const track = { id: 1, title: "Updated", artist: "Artist", album: "Album", durationMs: 1000 };
  let failure = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: (event: Event) => events.push(event.type) },
  });
  const invokeCommand: TracksInvoker = async <Result>(command: string, args?: unknown) => {
    const trackIds = (args as { trackIds: number[] }).trackIds;
    events.push(`${command}:${trackIds.join(",")}`);
    if (failure) throw new Error("database unavailable");
    return (trackIds.includes(1) ? [track] : []) as Result;
  };
  const { createTagSynchronization } = evaluateSource<
    typeof import("@/features/metadata/synchronize")
  >(output, {
    "@tauri-apps/api/core": { invoke: invokeCommand },

    "@/features/artwork/useTrackArtwork": {
      invalidateTrackArtworkCache: (ids: number[]) => events.push(`track-artwork:${ids.join(",")}`),
    },
    "@/features/artwork/useAlbumArtwork": {
      invalidateAlbumArtworkCache: () => events.push("album-artwork"),
    },
  });
  const synchronize = createTagSynchronization(
    {
      updateTrackMetadata: async (tracks) => {
        updates.push(tracks);
      },
    },
    invokeCommand,
  );
  return {
    events,
    updates,
    track,
    synchronize,
    fail: () => {
      failure = true;
    },
  };
}

describe("tag save synchronization", () => {
  it("publishes confirmed track details after a bulk read and updates only existing tracks", async () => {
    const harness = fixture();
    await harness.synchronize.tracks([1, 2]);
    expect(harness.events).toEqual([
      "get_tracks:1,2",
      "track-artwork:1,2",
      "album-artwork",
      "newbee:tracks-changed",
    ]);
    expect(harness.updates).toEqual([[harness.track]]);
  });

  it("invalidates both artwork caches when a release edit changes embedded covers", async () => {
    const harness = fixture();
    await harness.synchronize.artwork([1]);
    expect(harness.events).toEqual([
      "get_tracks:1",
      "track-artwork:1",
      "album-artwork",
      "newbee:tracks-changed",
    ]);
    expect(harness.updates).toEqual([[harness.track]]);
  });

  it("preserves the published change but rejects a failed reload without partially updating playback", async () => {
    const harness = fixture();
    harness.fail();
    await expect(harness.synchronize.tracks([1])).rejects.toThrow("database unavailable");
    expect(harness.events).toEqual([
      "get_tracks:1",
      "track-artwork:1",
      "album-artwork",
      "newbee:tracks-changed",
    ]);
    expect(harness.updates).toEqual([]);
  });
});
