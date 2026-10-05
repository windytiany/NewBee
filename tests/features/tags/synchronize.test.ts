import { afterEach, describe, expect, it } from "bun:test";
import { evaluateSource, transpileScript } from "../../support/moduleLoader";
import type { LibraryInvoker } from "@/features/library/api";
import type { TrackMetadataUpdate } from "@/features/playback/types";

const output = transpileScript(
  await Bun.file(new URL("../../../src/features/tags/synchronize.ts", import.meta.url)).text(),
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
  const invokeCommand: LibraryInvoker = async <Result>(command: string, args?: unknown) => {
    const trackId = (args as { trackId: number }).trackId;
    events.push(`${command}:${trackId}`);
    if (failure) throw new Error("database unavailable");
    return (trackId === 1 ? track : null) as Result;
  };
  const { createTagSynchronization } = evaluateSource<typeof import("@/features/tags/synchronize")>(
    output,
    {
      "@tauri-apps/api/core": { invoke: invokeCommand },
      "@/features/library/events": { LIBRARY_CHANGED_EVENT: "catalog-changed" },
      "@/features/artwork/useTrackArtwork": {
        invalidateTrackArtworkCache: (ids: number[]) =>
          events.push(`track-artwork:${ids.join(",")}`),
      },
      "@/features/artwork/useAlbumArtwork": {
        invalidateAlbumArtworkCache: () => events.push("album-artwork"),
      },
    },
  );
  const synchronize = createTagSynchronization(
    { updateTrackMetadata: (tracks) => updates.push(tracks) },
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
  it("publishes the catalog change before reloading tracks and updates only existing tracks", async () => {
    const harness = fixture();
    await harness.synchronize.tracks([1, 2]);
    expect(harness.events).toEqual(["catalog-changed", "get_track:1", "get_track:2"]);
    expect(harness.updates).toEqual([[harness.track]]);
  });

  it("invalidates both artwork caches first when a release edit changes embedded covers", async () => {
    const harness = fixture();
    await harness.synchronize.artwork([1]);
    expect(harness.events).toEqual([
      "track-artwork:1",
      "album-artwork",
      "catalog-changed",
      "get_track:1",
    ]);
    expect(harness.updates).toEqual([[harness.track]]);
  });

  it("preserves the published change but rejects a failed reload without partially updating playback", async () => {
    const harness = fixture();
    harness.fail();
    await expect(harness.synchronize.tracks([1])).rejects.toThrow("database unavailable");
    expect(harness.events).toEqual(["catalog-changed", "get_track:1"]);
    expect(harness.updates).toEqual([]);
  });
});
