import { afterEach, expect, it } from "bun:test";
import { createTagSynchronization } from "@/features/metadata/synchronize";
import { createTagEditor } from "@/features/metadata/manual/useEditor";
import { FILES_CHANGED_EVENT } from "@/features/metadata/events";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import type { EditableTrack } from "@/features/metadata/types";
import { notifications } from "@/shared/notifications/center";
afterEach(() => notifications.clear());
import { playbackFixture } from "../../../support/playback/session";
const path = "C:\\music\\file.wav";
function editable(): EditableTrack {
  return {
    track: {
      id: path,
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
it("opens real file targets in the shared tag editor and synchronizes only file metadata after saving", async () => {
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
      { rowKey: "file", trackId: null, path, title: "Original", album: "Album", durationMs: 1000 },
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
  let fileEvents = 0;
  let libraryEvents = 0;
  events.addEventListener(FILES_CHANGED_EVENT, () => {
    fileEvents += 1;
  });
  events.addEventListener(LIBRARY_CHANGED_EVENT, () => {
    libraryEvents += 1;
  });
  const invoked: string[] = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  try {
    const sync = createTagSynchronization(session, async <T>(command: string) => {
      invoked.push(command);
      return { ...editable().track, title: "Written" } as T;
    });
    const api = {
      editableTracks: async (targets: Array<number | string>) => {
        expect(targets).toEqual([path]);
        return [editable()];
      },
      saveMetadata: async (
        targets: Array<number | string>,
        changes: Array<{ field: string; value: string | null }>,
      ) => {
        expect(targets).toEqual([path]);
        expect(changes).toContainEqual({ field: "title", value: "Written" });
        expect(session.state.currentPlaybackId.value).toBeNull();
        return [{ trackId: path, path, fileWritten: true, databaseUpdated: false, error: null }];
      },
    };
    const editor = createTagEditor({
      loadTracks: api.editableTracks,
      loadAlbum: async () => [],
      save: api.saveMetadata,
      editFiles: session.withMetadataEditing,
      synchronize: sync.tracks,
    });
    await editor.openTracks([path]);
    expect(editor.state.open).toBe(true);
    expect(editor.state.tracks[0].track.id).toBe(path);
    const field = editor.state.draft.find((field) => field.key === "title");
    if (!field) throw new Error("Missing title field");
    editor.changeField(field, "Written");
    editor.prepareSave();
    await Bun.sleep(0);
    expect(editor.state.saving).toBe(false);
    expect(editor.state.results).toEqual([
      { trackId: path, path, fileWritten: true, databaseUpdated: false, error: null },
    ]);
    expect(editor.state.open).toBe(false);
    expect(invoked).toEqual(["read_audio_file"]);
    expect(fileEvents).toBe(1);
    expect(libraryEvents).toBe(0);
    expect(session.state.displayedTracks.value.map((track) => track.title)).toEqual([
      "Stored library title",
      "Written",
      "Other",
    ]);
    expect(session.state.currentTrack.value?.title).toBe("Written");
    expect(commands.find((command) => command.action === "beginEditing")).toEqual({
      action: "beginEditing",
      trackIds: [],
      paths: [path],
    });
    expect(commands.find((command) => command.action === "metadata")?.tracks).toContainEqual(
      expect.objectContaining({ id: null, path, title: "Written" }),
    );
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
