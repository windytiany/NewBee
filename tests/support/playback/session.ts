import { createPlaybackSession } from "@/features/playback/session";
import type { PlaybackSessionReply, PlaybackSessionSnapshot } from "@/features/playback/session";
import type { PlaybackCommandInvoker } from "@/features/playback/types";

export function playbackSnapshot(
  overrides: Partial<PlaybackSessionSnapshot> = {},
): PlaybackSessionSnapshot {
  return {
    revision: 0,
    structuralRevision: overrides.revision ?? 0,
    displayedTracks: [],
    currentRowKey: null,
    currentTrack: null,
    currentPlaybackId: null,
    playbackStatus: {
      hasAudio: false,
      isPlaying: false,
      hasEnded: false,
      positionMs: 0,
      durationMs: 0,
    },
    queuePlaybackError: "",
    playbackError: "",
    shuffleEnabled: false,
    repeatOneEnabled: false,
    canPlayPrevious: false,
    canPlayNext: false,
    skippedTrackIds: [],
    volume: 50,
    isEditing: false,
    isCommandPending: false,
    ...overrides,
  };
}

export function playbackReply(
  snapshot: PlaybackSessionSnapshot,
  overrides: Partial<PlaybackSessionReply> = {},
): PlaybackSessionReply {
  return { snapshot, applied: true, removal: null, editToken: null, ...overrides };
}

/** IPC fixture only. Scheduling/skip/gapless semantics are tested in Rust. */
export function playbackFixture(
  options: {
    paused?: boolean;
    canStop?: boolean;
    initialSnapshot?: PlaybackSessionSnapshot;
    invokeExtra?: (command: string, args?: Record<string, unknown>) => Promise<unknown> | unknown;
  } = {},
) {
  let snapshot = options.initialSnapshot ?? playbackSnapshot();
  const calls: string[] = [];
  let receive: (snapshot: PlaybackSessionSnapshot) => void = () => {};
  const commands: Record<string, unknown>[] = [];
  const failures = new Map<string, Error>();
  let nextId = 0;
  let nextReply: Promise<PlaybackSessionReply> | null = null;
  let nextQuery: Promise<PlaybackSessionReply> | null = null;
  const invokeCommand: PlaybackCommandInvoker = async <T>(
    name: string,
    args?: Record<string, unknown>,
  ) => {
    if (name === "playback_session_progress") {
      calls.push("progress");
      if (nextQuery !== null) {
        const query = nextQuery;
        nextQuery = null;
        const reply = await query;
        return {
          revision: reply.snapshot.revision,
          structuralRevision: reply.snapshot.structuralRevision,
          playbackStatus: {
            ...reply.snapshot.playbackStatus,
            playbackId: reply.snapshot.currentPlaybackId,
          },
        } as T;
      }
      return {
        revision: snapshot.revision,
        structuralRevision: snapshot.structuralRevision,
        playbackStatus: { ...snapshot.playbackStatus, playbackId: snapshot.currentPlaybackId },
      } as T;
    }
    if (name !== "playback_session_command" && name !== "playback_session_metadata") {
      if (name === "set_tracks_skipped") {
        if (options.invokeExtra) await options.invokeExtra(name, args);
        const ids = args?.trackIds as number[];
        snapshot = {
          ...snapshot,
          skippedTrackIds: args?.skipped
            ? [...new Set([...snapshot.skippedTrackIds, ...ids])]
            : snapshot.skippedTrackIds.filter((id) => !ids.includes(id)),
        };
        return undefined as T;
      }
      return (options.invokeExtra ? await options.invokeExtra(name, args) : null) as T;
    }
    const command =
      name === "playback_session_metadata"
        ? { action: "metadata", tracks: args?.tracks }
        : (args?.command as Record<string, unknown>);
    commands.push(command);
    const action = String(command.action);
    calls.push(action);
    if (failures.has(action)) throw failures.get(action);
    if (action === "snapshot" && nextQuery !== null) {
      const query = nextQuery;
      nextQuery = null;
      return (await query) as T;
    }
    if (nextReply !== null && action !== "snapshot") {
      const pending = nextReply;
      nextReply = null;
      const reply = await pending;
      snapshot = reply.snapshot;
      return reply as T;
    }
    let editToken: number | null = null;
    if (
      action === "playTracks" ||
      action === "playItem" ||
      (action === "toggle" && snapshot.currentPlaybackId === null)
    ) {
      if (action === "playTracks")
        snapshot = {
          ...snapshot,
          displayedTracks: command.tracks as PlaybackSessionSnapshot["displayedTracks"],
          currentRowKey: command.startRowKey as string,
        };
      if (action === "playItem")
        snapshot = { ...snapshot, currentRowKey: command.rowKey as string };
      const track = snapshot.displayedTracks.find(
        (track) => track.rowKey === snapshot.currentRowKey,
      );
      if (track)
        snapshot = {
          ...snapshot,
          currentTrack: {
            trackId: track.trackId,
            ...(track.path ? { path: track.path } : {}),
            title: track.title,
            artist: "Artist",
          },
          currentPlaybackId: ++nextId,
          playbackStatus: {
            hasAudio: true,
            isPlaying: !options.paused,
            hasEnded: false,
            positionMs: 0,
            durationMs: track.durationMs ?? 100,
          },
          canPlayNext: snapshot.displayedTracks.length > 1,
        };
    } else if (action === "toggle") {
      snapshot = {
        ...snapshot,
        playbackStatus: {
          ...snapshot.playbackStatus,
          isPlaying: !snapshot.playbackStatus.isPlaying,
        },
      };
    } else if (action === "beginEditing") {
      const ids = command.trackIds as number[];
      if (
        snapshot.currentTrack &&
        ((snapshot.currentTrack.trackId !== null && ids.includes(snapshot.currentTrack.trackId)) ||
          (snapshot.currentTrack.path !== undefined &&
            ((command.paths as string[] | undefined) ?? []).includes(
              snapshot.currentTrack.path,
            ))) &&
        snapshot.currentPlaybackId !== null
      ) {
        if (options.canStop === false) throw new Error("未能确认播放文件已释放，请重试。");
        snapshot = {
          ...snapshot,
          currentPlaybackId: null,
          playbackStatus: playbackSnapshot().playbackStatus,
        };
      }
      snapshot = { ...snapshot, isEditing: true };
      editToken = 1;
    } else if (action === "endEditing") {
      snapshot = { ...snapshot, isEditing: false };
    } else if (action === "add") {
      const tracks = command.tracks as PlaybackSessionSnapshot["displayedTracks"];
      snapshot = {
        ...snapshot,
        displayedTracks: [
          ...snapshot.displayedTracks,
          ...tracks.map((track) => ({ ...track, rowKey: `queue:${++nextId}` })),
        ],
      };
    } else if (action === "metadata") {
      const updates = command.tracks as Array<{
        id: number | null;
        path?: string;
        title: string | null;
        artist: string | null;
        album: string | null;
        durationMs: number | null;
      }>;
      snapshot = {
        ...snapshot,
        displayedTracks: snapshot.displayedTracks.map((track) => {
          const update = updates.find(
            (update) =>
              update.id === track.trackId &&
              (update.id !== null || (update.path != null && update.path === track.path)),
          );
          return update
            ? { ...track, title: update.title, album: update.album, durationMs: update.durationMs }
            : track;
        }),
        currentTrack: snapshot.currentTrack
          ? {
              ...snapshot.currentTrack,
              ...updates
                .filter(
                  (update) =>
                    update.id === snapshot.currentTrack?.trackId &&
                    (update.id !== null ||
                      (update.path != null && update.path === snapshot.currentTrack?.path)),
                )
                .map(({ title, artist }) => ({ title, artist }))[0],
            }
          : null,
      };
    } else if (action === "seek") {
      snapshot = {
        ...snapshot,
        playbackStatus: { ...snapshot.playbackStatus, positionMs: command.positionMs as number },
      };
    } else if (action === "repeat" || action === "shuffle") {
      snapshot = {
        ...snapshot,
        [action === "repeat" ? "repeatOneEnabled" : "shuffleEnabled"]: command.enabled,
      };
    }
    snapshot = { ...snapshot, revision: snapshot.revision + 1 };
    if (name === "playback_session_metadata") {
      const updates = command.tracks as Array<{ id: number | null; path?: string }>;
      return {
        revision: snapshot.revision,
        structuralRevision: snapshot.structuralRevision,
        displayedTracks: snapshot.displayedTracks.filter((row) =>
          updates.some(
            (update) =>
              update.id === row.trackId && (update.id !== null || update.path === row.path),
          ),
        ),
        currentTrack: snapshot.currentTrack,
      } as T;
    }
    snapshot = { ...snapshot, structuralRevision: snapshot.revision };
    return playbackReply(snapshot, { editToken }) as T;
  };
  const session = createPlaybackSession({
    invokeCommand,
    subscribe: async (listener) => {
      receive = listener;
      return () => {
        receive = () => {};
      };
    },
  });
  return {
    session,
    invokeCommand,
    calls,
    commands,
    get snapshot() {
      return snapshot;
    },
    emit: (overrides: Partial<PlaybackSessionSnapshot>) => {
      snapshot = {
        ...snapshot,
        ...overrides,
        revision: snapshot.revision + 1,
        structuralRevision: snapshot.revision + 1,
      };
      receive(snapshot);
    },
    fail: (action: string, error: Error) => {
      failures.set(action, error);
    },
    deferQuery: (reply: Promise<PlaybackSessionReply>) => {
      nextQuery = reply;
    },
    defer: (reply: Promise<PlaybackSessionReply>) => {
      nextReply = reply;
    },
  };
}
