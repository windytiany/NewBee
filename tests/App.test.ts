// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as TypeScript from "typescript";

const track = {
  id: 41,
  title: "Song",
  artist: "Artist",
  album: "Album",
  durationMs: 100,
};
type RemovalResult =
  | { status: "not-deleted"; message: string }
  | { status: "deleted" }
  | { status: "deleted-queue-sync-failed"; message: string };
type HostNode = {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  text: string;
};

let removalResult: RemovalResult = { status: "deleted" };
let removalCalls = 0;
let playlistRefreshCalls = 0;
let dialogShowCalls = 0;
let dialogCloseCalls = 0;
const mountedApps: Array<{ unmount: () => void }> = [];
const libraryTrackActionError = Vue.ref("");

function createComponent(source: string) {
  const { descriptor } = parse(source, { filename: "src/App.vue" });
  const compiled = compileScript(descriptor, { id: "app-test", inlineTemplate: true });
  const output = TypeScript.transpileModule(compiled.content, {
    compilerOptions: {
      module: TypeScript.ModuleKind.CommonJS,
      target: TypeScript.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const useLibraryPage = () => ({
    artists: Vue.ref([]),
    albums: Vue.ref([]),
    tracks: Vue.ref([track]),
    isLoadingArtists: Vue.ref(false),
    isLoadingAlbums: Vue.ref(false),
    isLoadingTracks: Vue.ref(false),
    artistsError: Vue.ref(""),
    albumsError: Vue.ref(""),
    tracksError: Vue.ref(""),
    isTrackActionPending: Vue.ref(false),
    trackActionError: libraryTrackActionError,
    trackActionMessage: Vue.ref(""),
    currentTrack: Vue.ref(null),
    activeQueueRowKey: Vue.ref(null),
    selectedGroup: Vue.ref({ albumArtist: "Artist", albumCount: 1 }),
    selectedAlbum: Vue.ref({ albumArtist: "Artist", album: "Album" }),
    selectArtist: () => {},
    selectAlbum: () => {},
    playTrackFromLibrary: () => {},
    playAlbumFromLibrary: () => {},
    addTracksToNext: () => {},
    addTracksToQueueEnd: () => {},
    addTracksToPlaylist: async () => ({ successfulTrackIds: [], failures: [] }),
    removeTrackFromLibrary: async () => {
      removalCalls += 1;
      if (removalResult.status === "not-deleted") {
        libraryTrackActionError.value = removalResult.message;
      } else if (removalResult.status === "deleted-queue-sync-failed") {
        libraryTrackActionError.value = removalResult.message;
      }
      return removalResult;
    },
  });
  const usePlaylistPage = () => ({
    playlists: Vue.ref([]),
    selectedPlaylistId: Vue.ref(null),
    selectedPlaylist: Vue.ref(null),
    playlistTracks: Vue.ref([]),
    isLoadingPlaylists: Vue.ref(false),
    isLoadingPlaylistTracks: Vue.ref(false),
    playlistsError: Vue.ref(""),
    playlistTracksError: Vue.ref(""),
    selectPlaylist: () => {},
    playTrackFromPlaylist: () => {},
    playPlaylistFromPage: () => {},
    refreshPlaylists: async () => {
      playlistRefreshCalls += 1;
    },
  });
  const passiveComponent = Vue.defineComponent({ setup: () => () => null });
  const AlbumBrowser = Vue.defineComponent({
    props: ["trackActionError"],
    setup(props, { emit }) {
      return () =>
        Vue.h("div", [
          Vue.h(
            "button",
            { "data-test": "request-delete", onClick: () => emit("delete-track", track.id) },
            "Delete",
          ),
          props.trackActionError
            ? Vue.h("p", { "data-test": "library-error" }, props.trackActionError)
            : null,
        ]);
    },
  });
  const DeleteTrackDialog = Vue.defineComponent({
    props: ["track", "error"],
    setup(props, { emit, expose }) {
      expose({
        show: () => {
          dialogShowCalls += 1;
        },
        close: () => {
          dialogCloseCalls += 1;
        },
      });
      return () =>
        Vue.h("div", { "data-test": "delete-dialog" }, [
          props.error ? Vue.h("p", { "data-test": "dialog-error" }, props.error) : null,
          Vue.h(
            "button",
            {
              "data-test": "confirm-delete",
              onClick: () => emit("confirm", props.track.id),
            },
            "Confirm",
          ),
        ]);
    },
  });
  const WorkspaceLayout = Vue.defineComponent({
    setup(_, { slots }) {
      return () => Vue.h("main", slots.center?.());
    },
  });
  const defaultModule = (component: Vue.Component) => ({ __esModule: true, default: component });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/navigation/activePage": {
      usePersistentActivePage: () => ({ activePage: Vue.ref("Library") }),
    },
    "@/library/usePage": { useLibraryPage },
    "@/playlist/usePage": { usePlaylistPage },
    "@/library/ui/AlbumBrowser.vue": defaultModule(AlbumBrowser),
    "@/library/ui/DeleteTrackDialog.vue": defaultModule(DeleteTrackDialog),
    "@/layout/WorkspaceLayout.vue": defaultModule(WorkspaceLayout),
  };
  for (const name of [
    "@/playing/PlayingPage.vue",
    "@/playback/ui/PlaybackBar.vue",
    "@/library/ui/ArtistList.vue",
    "@/playlist/ui/CreatePlaylistDialog.vue",
    "@/playlist/ui/PlaylistBrowser.vue",
    "@/playlist/ui/PlaylistList.vue",
    "@/navigation/TopBar.vue",
  ]) {
    modules[name] = defaultModule(passiveComponent);
  }
  const requireModule = (name: string) => modules[name];
  new Function("require", "module", "exports", output)(requireModule, module, module.exports);
  return module.exports.default as Vue.Component;
}

const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const appComponent = createComponent(
  await bunRuntime.Bun.file(new URL("../src/App.vue", import.meta.url)).text(),
);

function createHostNode(type: string, text = ""): HostNode {
  return { type, props: {}, children: [], parent: null, text };
}

function mountApp() {
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
  const root = createHostNode("root");
  const app = renderer.createApp(appComponent);
  app.mount(root);
  mountedApps.push(app);
  return root;
}

function findByTestId(node: HostNode, id: string): HostNode | null {
  if (node.props["data-test"] === id) return node;
  for (const child of node.children) {
    const match = findByTestId(child, id);
    if (match) return match;
  }
  return null;
}

function click(node: HostNode | null) {
  const handler = node?.props.onClick;
  if (typeof handler === "function") handler();
}

async function settleApp() {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  await Vue.nextTick();
}

beforeEach(() => {
  removalResult = { status: "deleted" };
  removalCalls = 0;
  playlistRefreshCalls = 0;
  dialogShowCalls = 0;
  dialogCloseCalls = 0;
  libraryTrackActionError.value = "";
});

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
});

describe("App track deletion confirmation", () => {
  it("keeps the dialog open and displays the database error when deletion did not happen", async () => {
    removalResult = { status: "not-deleted", message: "数据库不可用" };
    const root = mountApp();
    click(findByTestId(root, "request-delete"));
    await Vue.nextTick();
    await Vue.nextTick();

    click(findByTestId(root, "confirm-delete"));
    await settleApp();

    expect(dialogShowCalls).toBe(1);
    expect(dialogCloseCalls).toBe(0);
    expect(findByTestId(root, "delete-dialog")).not.toBeNull();
    expect(findByTestId(root, "dialog-error")?.text).toBe("数据库不可用");
    expect(playlistRefreshCalls).toBe(0);
  });

  it("closes after partial success and keeps the warning visible without retrying deletion", async () => {
    const warning = "曲库索引已删除，但停止当前播放失败：device busy";
    removalResult = { status: "deleted-queue-sync-failed", message: warning };
    const root = mountApp();
    click(findByTestId(root, "request-delete"));
    await Vue.nextTick();
    await Vue.nextTick();

    click(findByTestId(root, "confirm-delete"));
    await settleApp();

    expect(dialogCloseCalls).toBe(1);
    expect(findByTestId(root, "delete-dialog")).toBeNull();
    expect(findByTestId(root, "library-error")?.text).toBe(warning);
    expect(removalCalls).toBe(1);
    expect(playlistRefreshCalls).toBe(1);
  });
});
