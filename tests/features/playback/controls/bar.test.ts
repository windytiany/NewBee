import { setLocale, t } from "@/shared/i18n/locale";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import * as Icons from "@lucide/vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";

import { createHostNode, createHostRenderer } from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";
import { createPlaybackSession } from "@/features/playback/session";
import { playbackFixture, playbackReply } from "../../../support/playback/session";
import type { PlaybackStatus } from "@/features/playback/types";
import { useNotification } from "@/shared/notifications/useNotification";
import { notifications } from "@/shared/notifications/center";

type Session = ReturnType<typeof createPlaybackSession>;

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
): PlaybackStatus & { playbackId: number | null } {
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

const source = await Bun.file(
  new URL("../../../../src/features/playback/controls/PlaybackBar.vue", import.meta.url),
).text();
const compiled = compileSfc(source, "src/features/playback/controls/PlaybackBar.vue", {
  id: "playback-bar-test",
});
const modules: Record<string, unknown> = {
  vue: Vue,
  "@lucide/vue": Icons,
  "@/features/playback/controls/PlaybackSpectrum.vue": {
    __esModule: true,
    default: Vue.defineComponent({
      props: ["playbackId", "active"],
      setup: (props) => () =>
        Vue.h("div", {
          "data-playback-spectrum": true,
          "data-playback-id": props.playbackId,
          "data-active": props.active,
        }),
    }),
  },
  "@/shared/notifications/useNotification": { useNotification },
  "@/features/playback/controls/useControls": {
    usePlaybackControls: () => ({
      ...activeSession.state,
      isSeekInputActive: activeSession.state.isSeeking,
      selectedPositionMs: Vue.ref(0),
      setRepeatOneEnabled: activeSession.setRepeatOneEnabled,
      setShuffleEnabled: activeSession.setShuffleEnabled,
      playPreviousTrack: activeSession.playPreviousTrack,
      playNextTrack: activeSession.playNextTrack,
      togglePlayback: () => activeSession.togglePlayback(),
      handleSeekInput: () => {},
      commitSeek: () => {},
    }),
  },
  "@/features/playback/controls/useVolume": {
    usePlaybackVolume: () => ({
      volume: Vue.ref(100),
      volumeError: Vue.ref(""),
      toggleMute: () => {},
    }),
  },
};
const PlaybackBar = evaluateSource<{ default: Vue.Component }>(compiled, modules).default;

function mountBar(session: Session) {
  activeSession = session;
  const renderer = createHostRenderer(createHostNode, {
    createElement: (type) => {
      const node = createHostNode(type);
      return Object.assign(node, {
        tagName: type.toUpperCase(),
        addEventListener: () => {},
        removeEventListener: () => {},
        getAttribute: (name: string) => node.props[name] ?? null,
      });
    },
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
      node.type === "button" && [t("播放"), t("暂停")].includes(String(node.props["aria-label"])),
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
  const nextStatus = deferred<PlaybackStatus & { playbackId: number | null }>();
  const fixture = playbackFixture();
  let deferNextStatus = false;
  const snapshotForSecond = () => ({
    ...fixture.snapshot,
    revision: fixture.snapshot.revision + 1,
    currentPlaybackId: 2,
    currentRowKey: "b",
    currentTrack: { trackId: 2, title: "Track 2", artist: "Artist" },
    playbackStatus: status(2),
    isCommandPending: false,
    canPlayNext: false,
    canPlayPrevious: true,
  });
  // This is a backend reply, not a frontend queue scheduler.
  const backendNext = nextStart.promise.then(() => playbackReply(snapshotForSecond()));
  const originalNext = fixture.session.playNextTrack;
  const session = Object.freeze({
    ...fixture.session,
    playNextTrack: () => {
      fixture.defer(
        backendNext.catch(() =>
          playbackReply(
            {
              ...fixture.snapshot,
              revision: fixture.snapshot.revision + 1,
              currentTrack: null,
              currentRowKey: null,
              currentPlaybackId: null,
              playbackStatus: status(null),
              queuePlaybackError: "audio unavailable",
            },
            { applied: false },
          ),
        ),
      );
      return originalNext();
    },
  });
  return {
    session,
    nextStart,
    nextStatus,
    deferNextStatus: () => {
      deferNextStatus = true;
    },
    endTrack: async () => {
      if (fixture.snapshot.displayedTracks.length === 1) {
        fixture.emit({ playbackStatus: { ...status(1, false), positionMs: 0 } });
        return;
      }
      fixture.emit({
        isCommandPending: true,
        playbackStatus: { ...status(1, false), hasEnded: true, positionMs: 100 },
      });
      await nextStart.promise;
      fixture.emit(snapshotForSecond());
      if (deferNextStatus) {
        fixture.deferQuery(
          nextStatus.promise.then((playbackStatus) =>
            playbackReply({
              ...fixture.snapshot,
              revision: fixture.snapshot.revision + 1,
              playbackStatus,
            }),
          ),
        );
        void session.refreshPlaybackStatus();
      }
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
  notifications.clear();
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
    document: {
      documentElement: { lang: "zh-CN" },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  notifications.clear();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalGlobals.clear();
  setLocale("zh-CN");
});

describe("playback bar button", () => {
  it("keeps an active progress drag enabled while beginSeeking is pending", async () => {
    const fixture = playbackFixture();
    await fixture.session.ready;
    await startQueue(fixture.session);
    const root = mountBar(fixture.session);
    const progress = findNode(root, (node) => node.props["aria-label"] === t("播放进度"));
    if (!progress) throw new Error("Playback progress was not rendered");
    const begin = deferred<ReturnType<typeof playbackReply>>();
    fixture.defer(begin.promise);
    fixture.session.beginSeeking();
    fixture.emit({ isCommandPending: true });
    await Vue.nextTick();
    expect(progress.props.disabled).toBe(false);
    expect(playButton(root).props.disabled).toBe(true);
    fixture.emit({ isCommandPending: false });
    begin.resolve(playbackReply(fixture.snapshot));
    await fixture.session.seekTo(75);
    await Vue.nextTick();
    expect(progress.props.disabled).toBe(false);
    expect(playButton(root).props.disabled).toBe(false);
  });
  it("places the live spectrum after repeat and shuffle, and stops it when paused", async () => {
    const { session } = setupPlayback();
    await startQueue(session);
    const root = mountBar(session);
    const options = findNode(root, (node) => node.props["aria-label"] === t("播放选项"));
    const spectrum = findNode(root, (node) => node.props["data-playback-spectrum"] === true);
    if (!options || !spectrum) throw new Error("Playback options were not rendered");
    expect(options.children[0]?.props["aria-label"]).toBe(t("单曲循环"));
    expect(options.children[1]?.props["aria-label"]).toBe(t("随机播放"));
    expect(options.children[2]).toBe(spectrum);
    expect(spectrum.props["data-playback-id"]).toBe(1);
    expect(spectrum.props["data-active"]).toBe(true);
    await session.togglePlayback();
    await settle();
    expect(spectrum.props["data-active"]).toBe(false);
  });

  it("does not dim temporarily while switching tracks", async () => {
    const { session, nextStart } = setupPlayback();
    await startQueue(session);
    const root = mountBar(session);
    const switching = session.playNextTrack();
    await settle();
    const button = playButton(root);
    expect(button.props.disabled).toBe(true);
    expect(button.props["aria-label"]).toBe(t("暂停"));
    expect(isDimmed(button)).toBe(false);
    nextStart.resolve(started(2));
    await switching;
  });

  it("does not flash the Play icon during automatic advancement", async () => {
    const { session, nextStart, endTrack } = setupPlayback();
    await startQueue(session);
    const root = mountBar(session);
    expect(playButton(root).props["aria-label"]).toBe(t("暂停"));
    const advancing = endTrack();
    await settle();
    expect(session.state.isPlaybackCommandPending.value).toBe(true);
    expect(playButton(root).props["aria-label"]).toBe(t("暂停"));
    nextStart.resolve(started(2));
    await advancing;
    await settle();
    expect(playButton(root).props["aria-label"]).toBe(t("暂停"));
  });

  it("keeps the icon stable while waiting for the new track's status", async () => {
    const { session, nextStart, nextStatus, deferNextStatus, endTrack } = setupPlayback();
    await startQueue(session);
    const root = mountBar(session);
    deferNextStatus();
    const advancing = endTrack();
    await settle();
    nextStart.resolve(started(2));
    await advancing;
    await settle();
    expect(session.state.isPlaybackCommandPending.value).toBe(false);
    expect(session.state.isPlaybackStatusSettled.value).toBe(false);
    expect(playButton(root).props["aria-label"]).toBe(t("暂停"));
    expect(isDimmed(playButton(root))).toBe(false);

    nextStatus.resolve(status(2));
    await settle();
    expect(session.state.isPlaybackStatusSettled.value).toBe(true);
    expect(playButton(root).props["aria-label"]).toBe(t("暂停"));
  });

  it("shows Play when the queue truly ends", async () => {
    const { session, endTrack } = setupPlayback();
    await session.playTracks(
      [{ rowKey: "a", trackId: 1, title: "A", album: null, durationMs: 100 }],
      "a",
    );
    await settle();
    const root = mountBar(session);
    await endTrack();
    await session.refreshPlaybackStatus();
    await settle();
    expect(playButton(root).props["aria-label"]).toBe(t("播放"));
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
    expect(playButton(root).props["aria-label"]).toBe(t("播放"));
    expect(playButton(root).props.disabled).toBe(true);
    expect(isDimmed(playButton(root))).toBe(true);
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0].message).toBe("播放操作失败，请重试或查看日志");
    expect(findNode(root, (node) => node.props.role === "alert")).toBeNull();
  });

  it("reports a playback failure once across pending, event and reply snapshots", async () => {
    const fixture = playbackFixture();
    await fixture.session.ready;
    mountBar(fixture.session);
    fixture.emit({ queuePlaybackError: "Invalid playback target" });
    await settle();
    expect(notifications.items.value[0]?.count).toBe(1);
    fixture.emit({
      isCommandPending: true,
      playbackError: "播放操作失败，请重试或查看日志",
    });
    await settle();
    fixture.emit({ isCommandPending: false, playbackError: "" });
    await settle();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.count).toBe(1);
    fixture.emit({ queuePlaybackError: "" });
    await settle();
    fixture.emit({ queuePlaybackError: "Decode failed" });
    await settle();
    expect(notifications.items.value[0]?.count).toBe(2);
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
    await session.togglePlayback();
    await settle();
    expect(playButton(root).props["aria-label"]).toBe(t("播放"));
    await session.togglePlayback();
    await settle();
    expect(playButton(root).props["aria-label"]).toBe(t("暂停"));
  });
});

it("updates playback aria labels and named progress values when the language changes", async () => {
  const { session } = setupPlayback();
  await startQueue(session);
  const root = mountBar(session);
  expect(playButton(root).props["aria-label"]).toBe("暂停");
  const progress = findNode(root, (node) => node.props["aria-label"] === "播放进度")!;
  expect(progress.props["aria-valuetext"]).toBe("0:00 / 0:00");
  setLocale("en");
  await Vue.nextTick();
  expect(playButton(root).props["aria-label"]).toBe("Pause");
  expect(progress.props["aria-label"]).toBe("Playback progress");
  expect(progress.props["aria-valuetext"]).toBe("0:00 of 0:00");
  setLocale("zh-CN");
  await Vue.nextTick();
  expect(progress.props["aria-label"]).toBe("播放进度");
});
