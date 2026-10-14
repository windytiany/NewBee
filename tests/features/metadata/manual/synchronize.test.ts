import { afterEach, expect, it } from "bun:test";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import { createTagEditor } from "@/features/metadata/manual/useEditor";
import { TRACKS_CHANGED_EVENT } from "@/features/tracks/events";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import type { EditableTrack } from "@/features/metadata/types";
import { notifications } from "@/shared/notifications/center";
afterEach(() => notifications.clear());
import { playbackFixture } from "../../../support/playback/session";
const path = "C:\\music\\file.wav";
function editable(): EditableTrack {
  return {
    track: {
      id: 11,
      path,
      title: "Original",
      artist: "Artist",
      album: "Album",
      albumArtist: null,
      releaseDate: null,
      discNumber: null,
      trackNumber: null,
      discTotal: null,
      trackTotal: null,
      durationMs: 1000,
      codec: null,
      sampleRateHz: null,
      bitrateKbps: null,
      channels: null,
    },
    lyrics: null,
    noLyrics: false,
    writableFields: ["title", "lyrics"],
    values: { title: "Original" },
    issue: null,
  };
}
it("opens registered snapshots without reading files or registering, and refreshes numeric views once", async () => {
  const { session, commands } = playbackFixture();
  await session.playTracks(
    [
      {
        rowKey: "library",
        trackId: 7,
        title: "Stored library title",
        album: "Album",
        durationMs: 1000,
      },
      { rowKey: "file", trackId: 11, path, title: "Original", album: "Album", durationMs: 1000 },
      {
        rowKey: "other",
        trackId: null,
        path: "C:\\music\\other.wav",
        title: "Other",
        album: "Album",
        durationMs: 1000,
      },
    ],
    "file",
  );
  const events = new EventTarget();
  let libraryEvents = 0;
  let trackEvents = 0;
  events.addEventListener(TRACKS_CHANGED_EVENT, () => {
    trackEvents++;
  });
  events.addEventListener(LIBRARY_CHANGED_EVENT, () => {
    libraryEvents += 1;
  });
  const invoked: string[] = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  try {
    const sync = createTrackSynchronization(session, async <T>(command: string) => {
      invoked.push(command);
      if (command === "get_tracks") return [{ ...editable().track, id: 11, title: "Written" }] as T;
      throw new Error(`Unexpected ${command}`);
    });
    const api = {
      editableTracks: async (targets: number[]) => {
        expect(targets).toEqual([11]);
        return [editable()];
      },
      saveMetadata: async (
        targets: number[],
        changes: Array<{ field: string; value: string | null }>,
      ) => {
        expect(targets).toEqual([11]);
        expect(changes).toContainEqual({ field: "title", value: "Written" });
        expect(session.state.currentPlaybackId.value).toBeNull();
        return [{ trackId: 11, path, fileWritten: true, databaseUpdated: true, error: null }];
      },
    };
    const editor = createTagEditor({
      loadTracks: api.editableTracks,
      loadCollections: async (ids) =>
        ids.map((trackId) => ({ trackId, pictures: [], displayIndex: null, error: null })),
      planArtwork: async (drafts) =>
        drafts.map(({ trackId }) => ({ trackId, fileWriteRequired: true, error: null })),
      readArtwork: async () => {
        throw new Error("No artwork in this fixture");
      },
      loadAlbum: async () => [],
      save: api.saveMetadata,
      editFiles: session.withMetadataEditing,
      synchronize: sync.refresh,
    });
    await editor.openTracks([11]);
    expect(editor.state.open).toBe(true);
    expect(editor.state.tracks[0].track.id).toBe(11);
    const field = editor.state.draft.find((field) => field.key === "title");
    if (!field) throw new Error("Missing title field");
    editor.changeField(field, "Written");
    editor.prepareSave();
    await Bun.sleep(0);
    expect(editor.state.saving).toBe(false);
    expect(editor.state.results).toEqual([
      { trackId: 11, path, fileWritten: true, databaseUpdated: true, error: null },
    ]);
    expect(editor.state.open).toBe(false);
    expect(invoked).toEqual(["get_tracks"]);
    expect(trackEvents).toBe(1);
    expect(libraryEvents).toBe(0);
    expect(session.state.displayedTracks.value.map((track) => track.title)).toEqual([
      "Stored library title",
      "Written",
      "Other",
    ]);
    expect(session.state.currentTrack.value?.title).toBe("Written");
    expect(commands.find((command) => command.action === "beginEditing")).toEqual({
      action: "beginEditing",
      trackIds: [11],
    });
    expect(commands.find((command) => command.action === "metadata")?.tracks).toEqual([
      { id: 11, title: "Written", artist: "Artist", album: "Album", durationMs: 1000 },
    ]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
