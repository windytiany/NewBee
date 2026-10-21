import * as Vue from "vue";
import { ref } from "vue";
import { evaluateSource, transpileScript } from "../../support/module/loader";
import type { useInbox } from "@/features/inbox/useInbox";
import { INBOX_CHANGED_EVENT } from "@/features/inbox/api";
import { TRACKS_CHANGED_EVENT } from "@/features/tracks/events";
import { afterEach, describe, expect, it } from "bun:test";
import { createInbox } from "@/features/inbox/useInbox";
import { createInboxApi } from "@/features/inbox/api";
import type { InboxRead, InboxResult, InboxTrack } from "@/features/inbox/api";
import type { PlaybackDisplayTrack } from "@/features/playback/types";
import { notifications } from "@/shared/notifications/center";

function track(path: string, artist = "Artist"): InboxTrack {
  return {
    id: path.includes("one") ? 1 : 2,
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
function fixture(resultPathsChanged = false) {
  let read: InboxRead = {
    tracks: [track("C:\\music\\one.wav"), track("C:\\music\\two.wav", "Other")],
    failures: [],
  };
  let failure = false;
  let reads = 0;
  const calls: Array<{ action: string; trackIds: number[] }> = [];
  const playback: Array<readonly PlaybackDisplayTrack[]> = [];
  const starts: (string | null)[] = [];
  let changed = 0;
  const scans: number[][] = [];
  const scanPending = ref(false);
  const inbox = createInbox({
    reread: {
      pending: scanPending,
      reread: async (ids) => {
        scans.push([...ids]);
        return {
          results: ids.map((trackId) => ({
            trackId,
            databaseUpdated: trackId === 1,
            error: trackId === 1 ? null : "offline",
          })),
          refreshError: null,
        };
      },
    },
    api: {
      read: async () => {
        reads++;
        if (failure) throw new Error("read failed");
        return read;
      },
      register: async () => [],
      remove: async (trackIds) => {
        calls.push({ action: "remove", trackIds });
      },
      ingest: async (trackIds) => {
        calls.push({ action: "ingest", trackIds });
        return trackIds.map((trackId, index): InboxResult => ({
          trackId,
          skipped: false,
          path: resultPathsChanged
            ? "renamed.wav"
            : read.tracks.find((track) => track.id === trackId)!.path,
          success: index === 0,
          error: index === 0 ? null : "missing",
        }));
      },
    },
    session: {
      playTracks: async (tracks, start) => {
        starts.push(start);
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
    scans,
    reads: () => reads,
    scanPending,
    calls,
    playback,
    starts,
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
  it("passes existing numeric targets into the public playback session and filters artists", async () => {
    const context = fixture();
    await context.inbox.refresh();
    context.inbox.state.artist = { artist: "Artist", albumCount: 1 };
    await context.inbox.play(
      context.inbox.visibleTracks.value[0].id,
      context.inbox.visibleTracks.value.map((track) => track.id),
    );
    expect(context.playback[0]).toHaveLength(1);
    expect(context.playback[0][0]).toEqual({
      trackId: 1,
      rowKey: "inbox:1",
      title: "C:\\music\\one.wav",
      album: "Album",
      durationMs: 1000,
    });
    context.inbox.selectGrouping("artist");
    expect(context.inbox.visibleTracks.value).toHaveLength(2);
    await context.inbox.addNext([2]);
    expect(context.playback[1][0]).toEqual({
      trackId: 2,
      rowKey: "",
      title: "C:\\music\\two.wav",
      album: "Album",
      durationMs: 1000,
    });
    await context.inbox.addEnd([2]);
    expect(context.playback[2]).toEqual(context.playback[1]);
    expect(context.changed()).toBe(0);
  });
  it("uses the supplied visible order for playback and selected queue additions", async () => {
    const context = fixture();
    await context.inbox.refresh();
    const ids = context.inbox.visibleTracks.value.map((track) => track.id).reverse();
    await context.inbox.play(ids[1]!, ids);
    await context.inbox.addNext(ids);
    await context.inbox.addEnd(ids);
    expect(context.playback.map((tracks) => tracks.map((track) => track.trackId))).toEqual([
      ids,
      ids,
      ids,
    ]);
    expect(context.starts).toEqual([`inbox:${ids[1]}`]);
    expect(context.inbox.state.tracks.map((track) => track.id)).toEqual([...ids].reverse());
  });
  it("rejects stale, incomplete or duplicate display orders instead of queuing original order", async () => {
    const context = fixture();
    await context.inbox.refresh();
    const ids = context.inbox.visibleTracks.value.map((track) => track.id);
    await context.inbox.play(ids[0]!, [ids[0]!]);
    await context.inbox.play(ids[0]!, [ids[0]!, ids[0]!]);
    await context.inbox.play(ids[0]!, [ids[0]!, 99]);
    await context.inbox.play(99, ids);
    expect(context.playback).toEqual([]);
  });
  it("updates Inbox and library after successful ingest without a success notice", async () => {
    const context = fixture();
    await context.inbox.refresh();
    await context.inbox.ingest([1]);
    expect(context.inbox.state.results).toEqual([
      { trackId: 1, skipped: false, path: "C:\\music\\one.wav", success: true, error: null },
    ]);
    expect(context.inbox.state.tracks.map((track) => track.id)).toEqual([2]);
    expect(context.changed()).toBe(1);
    expect(notifications.items.value).toEqual([]);
    expect(context.inbox.state.pending).toBe(false);
  });
  it("removes successful ingest targets by result trackId rather than result path", async () => {
    const context = fixture(true);
    await context.inbox.refresh();
    await context.inbox.ingest([2, 1]);
    expect(context.calls).toEqual([{ action: "ingest", trackIds: [2, 1] }]);
    expect(context.inbox.state.results).toEqual([
      { trackId: 2, path: "renamed.wav", skipped: false, success: true, error: null },
      { trackId: 1, path: "renamed.wav", skipped: false, success: false, error: "missing" },
    ]);
    expect(context.inbox.state.tracks.map((track) => track.id)).toEqual([1]);
  });
  it("retains individual ingest failures and actual results through a later refresh failure", async () => {
    const context = fixture();
    await context.inbox.refresh();
    await context.inbox.ingest(context.inbox.state.tracks.map((track) => track.id));
    expect(context.inbox.state.results.map((result) => result.success)).toEqual([true, false]);
    expect(context.inbox.state.tracks.map((track) => track.id)).toEqual([2]);
    expect(context.changed()).toBe(1);
    expect(notifications.items.value.map((item) => item.type)).toEqual(["warning"]);
    context.fail();
    await context.inbox.refresh();
    expect(context.inbox.state.results.map((result) => result.success)).toEqual([true, false]);
    expect(context.inbox.state.error).not.toBe("");
  });
  it("removes registrations without touching playback and accepts fresh snapshots", async () => {
    const context = fixture();
    await context.inbox.refresh();
    await context.inbox.remove([1]);
    expect(context.calls).toEqual([{ action: "remove", trackIds: [1] }]);
    expect(context.playback).toEqual([]);
    expect(context.changed()).toBe(0);
    context.read({
      tracks: [{ ...track("C:\\music\\two.wav"), title: "Changed externally" }],
      failures: [
        { trackId: null, skipped: false, path: "C:\\gone.wav", success: false, error: "missing" },
      ],
    });
    await context.inbox.refresh();
    expect(context.inbox.state.tracks[0].title).toBe("Changed externally");
    expect(context.inbox.state.tracks).toHaveLength(1);
    expect(notifications.items.value.some((item) => item.type === "warning")).toBe(true);
  });
  it("keeps Inbox operations on their own IPC commands", async () => {
    const commands: string[] = [];
    const argumentsByCommand: unknown[] = [];
    const api = createInboxApi(async <T>(command: string, args?: unknown) => {
      commands.push(command);
      argumentsByCommand.push(args);
      return [] as T;
    });
    await api.register(["C:\\music\\one.wav"], false);
    await api.register(["C:\\music"], true);
    await api.remove([1]);
    await api.ingest([1]);
    expect(commands).toEqual(["register_inbox", "register_inbox", "remove_inbox", "ingest_inbox"]);
    expect(argumentsByCommand).toEqual([
      { paths: ["C:\\music\\one.wav"], directory: false },
      { paths: ["C:\\music"], directory: true },
      { trackIds: [1] },
      { trackIds: [1] },
    ]);
  });
  it("scans the whole Inbox, preserves failed snapshots and returns every target result", async () => {
    const context = fixture();
    await context.inbox.refresh();
    const before = context.inbox.state.tracks.map((track) => ({ ...track }));
    context.inbox.state.artist = { artist: "Artist", albumCount: 1 };
    context.read({ tracks: before.map((track) => ({ ...track, title: "Scanned" })), failures: [] });
    const outcome = await context.inbox.reread();
    expect(context.scans).toEqual([[1, 2]]);
    expect(outcome?.results).toEqual([
      { trackId: 1, databaseUpdated: true, error: null },
      { trackId: 2, databaseUpdated: false, error: "offline" },
    ]);
    expect(context.inbox.state.tracks).toEqual([{ ...before[0], title: "Scanned" }, before[1]]);
    expect(context.inbox.state.tracks.map((track) => track.addedAt)).toEqual(
      before.map((track) => track.addedAt),
    );
    expect(context.playback).toEqual([]);
    expect(notifications.items.value).toEqual([]);
    await context.inbox.reread([2]);
    expect(context.scans).toEqual([[1, 2], [2]]);
    expect(context.inbox.state.tracks[1]).toEqual(before[1]!);
  });
  it("keeps completed scan results and snapshots when the follow-up snapshot read fails", async () => {
    const context = fixture();
    await context.inbox.refresh();
    const before = context.inbox.state.tracks.map((track) => ({ ...track }));
    context.fail();
    const outcome = await context.inbox.reread([1, 2]);
    expect(outcome).toEqual({
      results: [
        { trackId: 1, databaseUpdated: true, error: null },
        { trackId: 2, databaseUpdated: false, error: "offline" },
      ],
      refreshError: "read failed",
    });
    expect(context.inbox.state.tracks).toEqual(before);
    expect(context.inbox.state.pending).toBe(false);
    // The shared reread action reports the scan failure; snapshot failure only logs.
    expect(notifications.items.value).toEqual([]);
  });
  it("gates duplicate scans and destructive actions, including a shared scan in progress", async () => {
    const context = fixture();
    await context.inbox.refresh();
    const first = context.inbox.reread();
    expect(context.inbox.state.pending).toBe(true);
    const blocked = [context.inbox.reread(), context.inbox.remove([1]), context.inbox.ingest([1])];
    expect(context.calls).toEqual([]);
    expect(context.scans).toEqual([[1, 2]]);
    await Promise.all([first, ...blocked]);
    context.scanPending.value = true;
    await context.inbox.reread();
    await context.inbox.ingest([1]);
    expect(context.scans).toEqual([[1, 2]]);
    expect(context.calls).toEqual([]);
  });
});

it("activation and ordinary events read snapshots without scanning offline original files", async () => {
  const window = new EventTarget();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  const calls: string[] = [];
  const output = transpileScript(await Bun.file("src/features/inbox/useInbox.ts").text());
  const module = evaluateSource<{ useInbox: typeof useInbox }>(output, {
    vue: Vue,
    "@tauri-apps/api/core": { isTauri: () => true },
    "@/features/inbox/api": {
      INBOX_CHANGED_EVENT,
      createInboxApi: () => ({
        read: async () => {
          calls.push("snapshot");
          return { tracks: [track("C:\\music\\one.wav")], failures: [] };
        },
        register: () => {
          throw new Error("No file registration during refresh");
        },
      }),
    },
    "@/features/tracks/useReread": {
      useTrackReread: () => ({
        pending: Vue.ref(false),
        reread: () => {
          throw new Error("No original file scans during refresh");
        },
      }),
    },
    "@/features/playback/session": { usePlaybackSession: () => ({}) },
  });
  const scope = Vue.effectScope();
  const active = Vue.ref(true);
  try {
    const inbox = scope.run(() => module.useInbox(active));
    await Vue.nextTick();
    expect(inbox?.state.tracks[0]?.id).toBe(1);
    for (const trackIds of [[2], []]) {
      window.dispatchEvent(new CustomEvent(TRACKS_CHANGED_EVENT, { detail: { trackIds } }));
      await Vue.nextTick();
    }
    expect(calls).toEqual(["snapshot"]);
    window.dispatchEvent(new Event(INBOX_CHANGED_EVENT));
    await Vue.nextTick();
    window.dispatchEvent(new CustomEvent(TRACKS_CHANGED_EVENT, { detail: { trackIds: [2, 1] } }));
    await Vue.nextTick();
    expect(calls).toEqual(["snapshot", "snapshot", "snapshot"]);
    window.dispatchEvent(
      new CustomEvent(TRACKS_CHANGED_EVENT, { detail: { trackIds: undefined } }),
    );
    await Vue.nextTick();
    expect(calls).toHaveLength(4);
    active.value = false;
    await Vue.nextTick();
    window.dispatchEvent(new Event(INBOX_CHANGED_EVENT));
    window.dispatchEvent(new CustomEvent(TRACKS_CHANGED_EVENT, { detail: { trackIds: [1] } }));
    expect(calls).toHaveLength(4);
    active.value = true;
    await Vue.nextTick();
    expect(calls).toHaveLength(5);
    scope.stop();
    window.dispatchEvent(new CustomEvent(TRACKS_CHANGED_EVENT, { detail: { trackIds: [1] } }));
    expect(calls).toHaveLength(5);
  } finally {
    scope.stop();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
