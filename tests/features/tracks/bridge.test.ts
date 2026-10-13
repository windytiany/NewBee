import { afterEach, expect, it } from "bun:test";
import { createTrackBridge } from "@/features/tracks/bridge";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import type { TrackReadResult } from "@/features/tracks/types";
import type { TracksInvoker } from "@/features/tracks/api";
import { playbackFixture } from "../../support/playback/session";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

it("coalesces confirmation batches into one IPC and updates duplicate queue references without replacing a later current track", async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  const { session, commands } = playbackFixture();
  await session.playTracks(
    [
      { trackId: 7, rowKey: "first", title: "Pending", album: null, durationMs: null },
      { trackId: 7, rowKey: "second", title: "Pending", album: null, durationMs: null },
      { trackId: 8, rowKey: "later", title: "Later", album: null, durationMs: null },
    ],
    "first",
  );
  let receive: (results: readonly TrackReadResult[]) => void = () => {};
  const calls: unknown[] = [];
  const invokeCommand: TracksInvoker = async <T>(command: string, args?: unknown) => {
    expect(command).toBe("get_tracks");
    calls.push(args);
    return [
      { id: 7, path: "song.flac", title: "Confirmed", artist: null, album: null, durationMs: 100 },
    ] as T;
  };
  const synchronization = createTrackSynchronization(session, invokeCommand);
  const errors: unknown[] = [];
  const bridge = createTrackBridge(
    synchronization.refresh,
    async (callback) => {
      receive = callback;
      return () => {};
    },
    (error) => errors.push(error),
  );
  await bridge.start();
  receive([{ trackId: 7, databaseUpdated: true, error: null }]);
  receive([{ trackId: 7, databaseUpdated: true, error: null }]);
  await session.playQueueItem("later");
  await Bun.sleep(60);
  bridge.dispose();
  expect(calls).toEqual([{ trackIds: [7] }]);
  expect(commands.filter((command) => command.action === "metadata")).toHaveLength(1);
  expect(session.state.displayedTracks.value.map((track) => track.title)).toEqual([
    "Confirmed",
    "Confirmed",
    "Later",
  ]);
  expect(session.state.currentTrack.value?.trackId).toBe(8);
  expect(errors).toEqual([]);
  session.dispose();
});

it("disposes a late subscription and cancels pending batches", async () => {
  let resolve: (stop: () => void) => void = () => {};
  let receive: (results: readonly TrackReadResult[]) => void = () => {};
  let stops = 0;
  const refreshed: number[][] = [];
  const bridge = createTrackBridge(
    async (ids) => {
      refreshed.push([...ids]);
    },
    (callback) => {
      receive = callback;
      return new Promise((done) => {
        resolve = done;
      });
    },
    () => {},
  );
  const starting = bridge.start();
  receive([{ trackId: 7, databaseUpdated: true, error: null }]);
  bridge.dispose();
  resolve(() => {
    stops += 1;
  });
  await starting;
  receive([{ trackId: 8, databaseUpdated: true, error: null }]);
  await Bun.sleep(40);
  expect(stops).toBe(1);
  expect(refreshed).toEqual([]);
});

it("reports partial failures while retaining successful refresh targets", async () => {
  let receive: (results: readonly TrackReadResult[]) => void = () => {};
  const refreshed: number[][] = [];
  const errors: unknown[] = [];
  const bridge = createTrackBridge(
    async (ids) => {
      refreshed.push([...ids]);
    },
    async (callback) => {
      receive = callback;
      return () => {};
    },
    (error) => errors.push(error),
  );
  await bridge.start();
  receive([
    { trackId: 7, databaseUpdated: true, error: null },
    { trackId: 8, databaseUpdated: true, error: "Unreadable tags" },
  ]);
  await Bun.sleep(40);
  bridge.dispose();
  expect(refreshed).toEqual([[7, 8]]);
  expect(errors).toEqual(["Unreadable tags"]);
});

it("does not apply a batch response after the application bridge is disposed", async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  let resolve: () => void = () => {};
  let updates = 0;
  let active = true;
  const invocation: TracksInvoker = async <T>() => {
    await new Promise<void>((done) => {
      resolve = done;
    });
    return [] as T;
  };
  const synchronization = createTrackSynchronization(
    {
      updateTrackMetadata: async () => {
        updates += 1;
      },
    },
    invocation,
  );
  const refreshing = synchronization.refresh([7], () => active);
  active = false;
  resolve();
  await refreshing;
  expect(updates).toBe(0);
});
