import { afterEach, describe, expect, it } from "bun:test";
import { createInbox } from "@/features/inbox/useInbox";
import { createInboxApi } from "@/features/inbox/api";
import type { InboxRead, InboxResult, InboxTrack } from "@/features/inbox/api";
import type { PlaybackDisplayTrack } from "@/features/playback/types";
import { notifications } from "@/shared/notifications/center";

function track(path: string, artist = "Artist"): InboxTrack {
  return {
    id: path,
    path,
    addedAt: 1_700_000_000_000,
    title: path,
    artist,
    album: "Album",
    albumArtist: artist,
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
  };
}
function fixture() {
  let read: InboxRead = {
    tracks: [track("C:\\music\\one.wav"), track("C:\\music\\two.wav", "Other")],
    failures: [],
  };
  let failure = false;
  const calls: Array<{ action: string; paths: string[] }> = [];
  const playback: Array<readonly PlaybackDisplayTrack[]> = [];
  let changed = 0;
  const inbox = createInbox({
    api: {
      read: async () => {
        if (failure) throw new Error("read failed");
        return read;
      },
      register: async () => [],
      remove: async (paths) => {
        calls.push({ action: "remove", paths });
      },
      ingest: async (paths) => {
        calls.push({ action: "ingest", paths });
        return paths.map((path, index): InboxResult => ({
          path,
          success: index === 0,
          error: index === 0 ? null : "missing",
        }));
      },
    },
    session: {
      playTracks: async (tracks, start) => {
        expect(start).toBe(`inbox:${tracks[0]?.path}`);
        playback.push(tracks);
        return true;
      },
      addTracksToNext: async (tracks) => {
        playback.push(tracks.map((track) => ({ ...track, rowKey: "" })));
        return true;
      },
      addTracksToQueueEnd: async (tracks) => {
        playback.push(tracks.map((track) => ({ ...track, rowKey: "" })));
        return true;
      },
    },
    changed: () => {
      changed++;
    },
  });
  return {
    inbox,
    calls,
    playback,
    changed: () => changed,
    read: (value: InboxRead) => {
      read = value;
    },
    fail: () => {
      failure = true;
    },
  };
}
afterEach(() => notifications.clear());
describe("Inbox controller", () => {
  it("passes genuine file targets into the public playback session and filters artists", async () => {
    const context = fixture();
    await context.inbox.refresh();
    context.inbox.state.artist = { artist: "Artist", albumCount: 1 };
    await context.inbox.play(context.inbox.visibleTracks.value[0].path);
    expect(context.playback[0]).toHaveLength(1);
    expect(context.playback[0][0]).toMatchObject({ trackId: null, path: "C:\\music\\one.wav" });
    context.inbox.selectGrouping("artist");
    expect(context.inbox.visibleTracks.value).toHaveLength(2);
    await context.inbox.addNext(["C:\\music\\two.wav"]);
    expect(context.playback[1][0]).toMatchObject({ trackId: null, path: "C:\\music\\two.wav" });
    expect(context.changed()).toBe(0);
  });
  it("retains individual ingest failures and actual results through a later refresh failure", async () => {
    const context = fixture();
    await context.inbox.refresh();
    await context.inbox.ingest(context.inbox.state.tracks.map((track) => track.path));
    expect(context.inbox.state.results.map((result) => result.success)).toEqual([true, false]);
    expect(context.inbox.state.tracks.map((track) => track.path)).toEqual(["C:\\music\\two.wav"]);
    expect(context.changed()).toBe(1);
    context.fail();
    await context.inbox.refresh();
    expect(context.inbox.state.results.map((result) => result.success)).toEqual([true, false]);
    expect(context.inbox.state.error).not.toBe("");
  });
  it("removes registrations without touching playback and accepts fresh file information", async () => {
    const context = fixture();
    await context.inbox.refresh();
    await context.inbox.remove(["C:\\music\\one.wav"]);
    expect(context.calls).toEqual([{ action: "remove", paths: ["C:\\music\\one.wav"] }]);
    expect(context.playback).toEqual([]);
    expect(context.changed()).toBe(0);
    context.read({
      tracks: [{ ...track("C:\\music\\two.wav"), title: "Changed externally" }],
      failures: [{ path: "C:\\gone.wav", success: false, error: "missing" }],
    });
    await context.inbox.refresh();
    expect(context.inbox.state.tracks[0].title).toBe("Changed externally");
    expect(context.inbox.state.tracks).toHaveLength(1);
    expect(notifications.items.value.some((item) => item.type === "warning")).toBe(true);
  });
  it("keeps Inbox operations on their own IPC commands", async () => {
    const commands: string[] = [];
    const api = createInboxApi(async <T>(command: string) => {
      commands.push(command);
      return [] as T;
    });
    await api.register(["C:\\music\\one.wav"], false);
    await api.register(["C:\\music"], true);
    await api.remove(["C:\\music\\one.wav"]);
    await api.ingest(["C:\\music\\one.wav"]);
    expect(commands).toEqual(["register_inbox", "register_inbox", "remove_inbox", "ingest_inbox"]);
  });
});
