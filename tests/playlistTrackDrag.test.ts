// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { PlaylistTrackData } from "@/types/playlist";

type HostNode = {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  text: string;
};

function createHostNode(type: string, text = ""): HostNode {
  return { type, props: {}, children: [], parent: null, text };
}

function createPlaylistTrackComponent(source: string) {
  const { descriptor } = parse(source, { filename: "src/playlist/ui/PlaylistTrack.vue" });
  const compiled = compileScript(descriptor, {
    id: "playlist-track-drag-test",
    inlineTemplate: true,
  });
  const output = transpileModule(compiled.content, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/utils/formatTrack.ts": { formatTrackDuration: () => "0:01" },
  };
  const requireModule = (name: string) => modules[name];
  new Function("require", "module", "exports", output)(requireModule, module, module.exports);
  return module.exports.default as Vue.Component;
}

const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const playlistTrack = createPlaylistTrackComponent(
  await bunRuntime.Bun.file(
    new URL("../src/playlist/ui/PlaylistTrack.vue", import.meta.url),
  ).text(),
);
const track: PlaylistTrackData = {
  playlistItemId: 101,
  trackId: 1,
  title: "Track",
  artist: "Artist",
  album: "Album",
  durationMs: 1000,
};

function findNode(root: HostNode, predicate: (node: HostNode) => boolean): HostNode | null {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

describe("歌单曲目拖拽手势", () => {
  it("从曲目主体按下时启动重排手势", () => {
    const renderer = Vue.createRenderer<HostNode, HostNode>({
      patchProp: (node, key, _previous, next) => {
        node.props[key] = next;
      },
      insert: (node, parent, anchor) => {
        if (node.parent) {
          const oldIndex = node.parent.children.indexOf(node);
          if (oldIndex >= 0) node.parent.children.splice(oldIndex, 1);
        }
        node.parent = parent;
        const index = anchor ? parent.children.indexOf(anchor) : -1;
        if (index < 0) parent.children.push(node);
        else parent.children.splice(index, 0, node);
      },
      remove: (node) => {
        if (!node.parent) return;
        const index = node.parent.children.indexOf(node);
        if (index >= 0) node.parent.children.splice(index, 1);
        node.parent = null;
      },
      createElement: (type) => createHostNode(type),
      createText: (text) => createHostNode("#text", text),
      createComment: (text) => createHostNode("#comment", text),
      setText: (node, text) => {
        node.text = text;
      },
      setElementText: (node, text) => {
        node.text = text;
        node.children = [];
      },
      parentNode: (node) => node.parent,
      nextSibling: (node) => {
        if (!node.parent) return null;
        return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null;
      },
    });
    const emitted: Array<{ playlistItemId: number; event: unknown }> = [];
    const root = createHostNode("root");
    const app = renderer.createApp({
      render: () =>
        Vue.h(playlistTrack, {
          track,
          trackNumber: 1,
          isFocused: false,
          isSelected: false,
          isCurrentTrack: false,
          onReorderPointerDown: (playlistItemId: number, event: unknown) =>
            emitted.push({ playlistItemId, event }),
        }),
    });
    app.mount(root);

    try {
      const trackButton = findNode(
        root,
        (node) => node.props["data-playlist-track-select"] !== undefined,
      );
      if (!trackButton) throw new Error("Playlist track body was not rendered.");
      const pointerDown = trackButton.props.onPointerdown;
      if (typeof pointerDown !== "function") {
        throw new Error("Playlist track body does not start the reorder gesture.");
      }

      const touchEvent = { pointerType: "touch" };
      pointerDown(touchEvent);
      expect(emitted).toEqual([]);

      const mouseEvent = { pointerType: "mouse" };
      pointerDown(mouseEvent);
      expect(emitted).toEqual([{ playlistItemId: track.playlistItemId, event: mouseEvent }]);
    } finally {
      app.unmount();
    }
  });
});
