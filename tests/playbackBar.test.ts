// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import * as Icons from "@lucide/vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { createPlaybackSession } from "@/playback/session";
import type { PlaybackCommandInvoker } from "@/playback/state";
import type { InternalPlaybackStatus } from "@/playback/status";

type Session = ReturnType<typeof createPlaybackSession>;
type HostNode = {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  text: string;
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function status(
  playbackId: number | null,
  isPlaying = playbackId !== null,
): InternalPlaybackStatus {
  return {
    playbackId,
    hasAudio: playbackId !== null,
    isPlaying,
    hasEnded: false,
    positionMs: 10,
    durationMs: playbackId === null ? 0 : 100,
  };
}

function started(trackId: number) {
  return { trackId, title: `Track ${trackId}`, artist: "Artist", playbackId: trackId };
}

let activeSession: Session;
const apps: Array<{ unmount: () => void }> = [];
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const source = await bunRuntime.Bun.file(
  new URL("../src/playback/ui/PlaybackBar.vue", import.meta.url),
).text();
const { descriptor } = parse(source, { filename: "src/playback/ui/PlaybackBar.vue" });
const script = compileScript(descriptor, { id: "playback-bar-test", inlineTemplate: true });
const compiled = transpileModule(script.content, {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
}).outputText;
const componentModule = { exports: {} as Record<string, unknown> };
const modules: Record<string, unknown> = {
  vue: Vue,
  "@lucide/vue": Icons,
  "@/playback/useControls": {
    usePlaybackControls: () => ({
      ...activeSession.state,
      selectedPositionMs: Vue.ref(0),
      setRepeatOneEnabled: activeSession.setRepeatOneEnabled,
      setShuffleEnabled: activeSession.setShuffleEnabled,
      playPreviousTrack: activeSession.playPreviousTrack,
      playNextTrack: activeSession.playNextTrack,
      togglePlayback: () => activeSession.togglePlayback(async () => true),
      handleSeekInput: () => {},
      commitSeek: () => {},
    }),
  },
  "@/playback/useVolume": {
    usePlaybackVolume: () => ({
      volume: Vue.ref(100),
      volumeError: Vue.ref(""),
      toggleMute: () => {},
      ensureCurrentVolumeIsSynchronized: async () => true,
    }),
  },
};
new Function("require", "module", "exports", compiled)(
  (name: string) => modules[name],
  componentModule,
  componentModule.exports,
);
const PlaybackBar = componentModule.exports.default as Vue.Component;

function mountBar(session: Session) {
  activeSession = session;
  const renderer = Vue.createRenderer<HostNode, HostNode>({
    patchProp: (node, key, _previous, next) => {
      node.props[key] = next;
    },
    insert: (node, parent, anchor) => {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(node);
      else parent.children.splice(index, 0, node);
    },
    remove: (node) => {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = null;
    },
    createElement: (type) => {
      const node: HostNode = { type, props: {}, children: [], parent: null, text: "" };
      return Object.assign(node, {
        tagName: type.toUpperCase(),
        addEventListener: () => {},
        removeEventListener: () => {},
        getAttribute: (name: string) => node.props[name] ?? null,
      });
    },
    createText: (text) => ({ type: "#text", props: {}, children: [], parent: null, text }),
    createComment: (text) => ({ type: "#comment", props: {}, children: [], parent: null, text }),
    setText: (node, text) => {
      node.text = text;
    },
    setElementText: (node, text) => {
      node.text = text;
      node.children = [];
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  });
  const root: HostNode = { type: "root", props: {}, children: [], parent: null, text: "" };
  const app = renderer.createApp(PlaybackBar);
  app.mount(root);
  apps.push(app);
  return root;
}

function findNode(root: HostNode, predicate: (node: HostNode) => boolean): HostNode | null {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function playButton(root: HostNode) {
  const button = findNode(
    root,
    (node) =>
      node.type === "button" && ["Play", "Pause"].includes(String(node.props["aria-label"])),
  );
  if (!button) throw new Error("Playback button was not rendered.");
  return button;
}

function isDimmed(button: HostNode) {
  const classes = String(button.props.class).split(" ");
  return (
    classes.includes("opacity-50") ||
    (button.props.disabled === true && classes.includes("disabled:opacity-50"))
  );
}

async function settle() {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  await Vue.nextTick();
}

function setupPlayback() {
  const nextStart = deferred<ReturnType<typeof started>>();
  const nextStatus = deferred<InternalPlaybackStatus>();
  let deferNextStatus = false;
  let activeStatus = status(null);
  const handler = (command: string, args?: Record<string, unknown>) => {
    if (command === "playback_status") {
      return deferNextStatus && activeStatus.playbackId === 2 ? nextStatus.promise : activeStatus;
    }
    if (command === "play_track") {
      const trackId = args?.trackId as number;
      if (trackId === 2)
        return nextStart.promise.then((track) => {
          activeStatus = status(2);
          return track;
        });
      activeStatus = status(trackId);
      return started(trackId);
    }
    if (command === "stop_playback") {
      activeStatus = status(null);
      return true;
    }
    if (command === "pause") {
      activeStatus = { ...activeStatus, isPlaying: false };
      return;
    }
    if (command === "resume") {
      activeStatus = { ...activeStatus, isPlaying: true };
      return;
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  const invokeCommand: PlaybackCommandInvoker = async <Result>(
    command: string,
    args?: Record<string, unknown>,
  ) => (await handler(command, args)) as Result;
  const session = createPlaybackSession({ invokeCommand, restoredQueueSnapshot: null });
  return {
    session,
    nextStart,
    nextStatus,
    deferNextStatus: () => {
      deferNextStatus = true;
    },
    endTrack: () => {
      activeStatus = { ...status(1, false), hasEnded: true, positionMs: 100 };
    },
  };
}

async function startQueue(session: Session) {
  await session.playTracks(
    [
      { rowKey: "a", trackId: 1, title: "A", album: null, durationMs: 100 },
      { rowKey: "b", trackId: 2, title: "B", album: null, durationMs: 100 },
    ],
    "a",
  );
  await settle();
}

beforeEach(() => {
  const stored = new Map<string, string>();
  const globals = {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    document: { addEventListener: () => {}, removeEventListener: () => {} },
  };
  for (const [key, value] of Object.entries(globals)) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalGlobals.clear();
});

describe("playback bar button", () => {
  it("does not dim temporarily while switching tracks", async () => {
    const { session, nextStart } = setupPlayback();
    await startQueue(session);
    const root = mountBar(session);
    const switching = session.playNextTrack();
    await settle();
    const button = playButton(root);
    expect(button.props.disabled).toBe(true);
    expect(button.props["aria-label"]).toBe("Pause");
    expect(isDimmed(button)).toBe(false);
    nextStart.resolve(started(2));
    await switching;
  });

  it("does not flash the Play icon during automatic advancement", async () => {
    const { session, nextStart, endTrack } = setupPlayback();
    await startQueue(session);
    const root = mountBar(session);
    expect(playButton(root).props["aria-label"]).toBe("Pause");
    endTrack();
    const advancing = session.refreshPlaybackStatus();
    await settle();
    expect(session.state.isPlaybackCommandPending.value).toBe(true);
    expect(playButton(root).props["aria-label"]).toBe("Pause");
    nextStart.resolve(started(2));
    await advancing;
    await settle();
    expect(playButton(root).props["aria-label"]).toBe("Pause");
  });

  it("keeps the icon stable while waiting for the new track's status", async () => {
    const { session, nextStart, nextStatus, deferNextStatus, endTrack } = setupPlayback();
    await startQueue(session);
    const root = mountBar(session);
    deferNextStatus();
    endTrack();
    const advancing = session.refreshPlaybackStatus();
    await settle();
    nextStart.resolve(started(2));
    await advancing;
    await settle();
    expect(session.state.isPlaybackCommandPending.value).toBe(false);
    expect(session.state.isPlaybackStatusSettled.value).toBe(false);
    expect(playButton(root).props["aria-label"]).toBe("Pause");
    expect(isDimmed(playButton(root))).toBe(false);

    nextStatus.resolve(status(2));
    await settle();
    expect(session.state.isPlaybackStatusSettled.value).toBe(true);
    expect(playButton(root).props["aria-label"]).toBe("Pause");
  });

  it("shows Play when the queue truly ends", async () => {
    const { session, endTrack } = setupPlayback();
    await session.playTracks(
      [{ rowKey: "a", trackId: 1, title: "A", album: null, durationMs: 100 }],
      "a",
    );
    await settle();
    const root = mountBar(session);
    endTrack();
    await session.refreshPlaybackStatus();
    await settle();
    expect(playButton(root).props["aria-label"]).toBe("Play");
    expect(session.state.isPlaybackStatusSettled.value).toBe(true);
  });

  it("releases the command lock when switching fails", async () => {
    const { session, nextStart } = setupPlayback();
    await startQueue(session);
    const root = mountBar(session);
    const switching = session.playNextTrack();
    await settle();
    nextStart.reject(new Error("audio unavailable"));
    await switching;
    await settle();
    expect(session.state.isPlaybackCommandPending.value).toBe(false);
    expect(session.state.currentTrack.value).toBeNull();
    expect(playButton(root).props["aria-label"]).toBe("Play");
    expect(playButton(root).props.disabled).toBe(true);
    expect(isDimmed(playButton(root))).toBe(true);
  });

  it("still dims when no song or restored queue can be played", () => {
    const { session } = setupPlayback();
    const button = playButton(mountBar(session));
    expect(button.props.disabled).toBe(true);
    expect(isDimmed(button)).toBe(true);
  });

  it("reflects an actual pause and resume", async () => {
    const { session } = setupPlayback();
    await startQueue(session);
    const root = mountBar(session);
    await session.togglePlayback(async () => true);
    await settle();
    expect(playButton(root).props["aria-label"]).toBe("Play");
    await session.togglePlayback(async () => true);
    await settle();
    expect(playButton(root).props["aria-label"]).toBe("Pause");
  });
});
