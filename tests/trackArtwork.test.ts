// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as Vue from "vue";
import { effectScope, nextTick, ref } from "vue";
import type { Ref } from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as TypeScript from "typescript";
import type { TrackArtwork } from "@/types/track";

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: Error) => void;
};

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let artworkRequest: (trackId: number) => Promise<TrackArtwork | null>;
let decodeImage: (image: TestImage) => Promise<void>;
let invokedTrackIds: number[];
let revokedUrls: string[];
let nextObjectUrl: number;
let decodeCount: number;
let imageInstances: TestImage[];
const mountedScopes: Array<{ stop: () => void }> = [];
const mountedApps: Array<{ unmount: () => void }> = [];
const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

class TestImage {
  src = "";

  constructor() {
    imageInstances.push(this);
  }

  decode() {
    return decodeImage(this);
  }

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

mock.module("@tauri-apps/api/core", () => ({
  invoke: (_command: string, args?: { trackId: number }) => {
    if (!args) throw new Error("Artwork request is missing its track ID.");
    invokedTrackIds.push(args.trackId);
    return artworkRequest(args.trackId);
  },
}));

const artworkModule = await import("@/artwork/trackArtwork");
const { useTrackArtwork } = artworkModule;
const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};

function createTrackArtworkComponent(source: string) {
  const { descriptor } = parse(source, { filename: "src/artwork/ui/TrackArtwork.vue" });
  const compiled = compileScript(descriptor, { id: "track-artwork-test", inlineTemplate: true });
  const output = TypeScript.transpileModule(compiled.content, {
    compilerOptions: {
      module: TypeScript.ModuleKind.CommonJS,
      target: TypeScript.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/artwork/trackArtwork": artworkModule,
  };
  new Function("require", "module", "exports", output)(
    (name: string) => modules[name],
    module,
    module.exports,
  );
  return module.exports.default as Vue.Component;
}

const trackArtworkComponent = createTrackArtworkComponent(
  await bunRuntime.Bun.file(new URL("../src/artwork/ui/TrackArtwork.vue", import.meta.url)).text(),
);

function mountArtwork(trackId: Ref<number | null> | number) {
  let artwork!: ReturnType<typeof useTrackArtwork>;
  const scope = effectScope();
  scope.run(() => {
    artwork = useTrackArtwork(trackId);
  });
  mountedScopes.push(scope);
  return { artwork, dispose: () => scope.stop() };
}

async function settleArtwork() {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
}

type ArtworkHostNode = {
  type: string;
  props: Record<string, unknown>;
  children: ArtworkHostNode[];
  parent: ArtworkHostNode | null;
  text: string;
};

function mountArtworkComponent(trackId: Ref<number | null>) {
  const renderer = Vue.createRenderer<ArtworkHostNode, ArtworkHostNode>({
    patchProp: (node, key, _previous, next) => {
      node.props[key] = next;
    },
    insert: (node, parent, anchor) => {
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
    createElement: (type) => ({ type, props: {}, children: [], parent: null, text: "" }),
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
    nextSibling: (node) => {
      if (!node.parent) return null;
      return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null;
    },
  });
  const root: ArtworkHostNode = { type: "root", props: {}, children: [], parent: null, text: "" };
  const app = renderer.createApp({
    setup: () => () =>
      Vue.h(
        trackArtworkComponent,
        { trackId: trackId.value, alt: "cover" },
        { default: () => Vue.h("span", { "data-test": "fallback" }, "fallback") },
      ),
  });
  app.mount(root);
  mountedApps.push(app);
  return root;
}

function findArtworkNode(root: ArtworkHostNode, type: string): ArtworkHostNode | null {
  if (root.type === type) return root;
  for (const child of root.children) {
    const match = findArtworkNode(child, type);
    if (match) return match;
  }
  return null;
}

beforeEach(() => {
  invokedTrackIds = [];
  revokedUrls = [];
  nextObjectUrl = 0;
  decodeCount = 0;
  imageInstances = [];
  artworkRequest = async () => ({ status: "available", mimeType: "image/png", data: [1, 2, 3] });
  decodeImage = async () => {};
  Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => `blob:artwork-${++nextObjectUrl}`,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => revokedUrls.push(url),
  });
});

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  for (const scope of mountedScopes.splice(0)) scope.stop();
  for (const [target, key, descriptor] of [
    [globalThis, "Image", originalImage],
    [URL, "createObjectURL", originalCreateObjectURL],
    [URL, "revokeObjectURL", originalRevokeObjectURL],
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});

describe("曲目封面加载", () => {
  it("两处封面共享请求，并在最后一个订阅者释放时回收资源", async () => {
    const first = mountArtwork(71);
    const second = mountArtwork(71);
    await settleArtwork();

    expect(invokedTrackIds).toEqual([71]);
    expect(first.artwork.status.value).toBe("ready");
    expect(second.artwork.url.value).toBe("blob:artwork-1");

    first.dispose();
    expect(revokedUrls).toEqual([]);
    second.dispose();
    expect(revokedUrls).toEqual(["blob:artwork-1"]);
  });

  it("来源未改变时不重复请求，且请求和解码期间不显示 fallback", async () => {
    const request = deferred<TrackArtwork | null>();
    const decoding = deferred<void>();
    artworkRequest = () => request.promise;
    decodeImage = () => decoding.promise;
    const source = ref<number | null>(72);
    const { artwork } = mountArtwork(source);
    const root = mountArtworkComponent(source);

    expect(artwork.status.value).toBe("loading");
    expect(artwork.url.value).toBeNull();
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(findArtworkNode(root, "img")).toBeNull();
    source.value = 72;
    await nextTick();
    expect(invokedTrackIds).toEqual([72]);

    request.resolve({ status: "available", mimeType: "image/png", data: [4, 5, 6] });
    await settleArtwork();
    expect(imageInstances).toHaveLength(1);
    expect(artwork.status.value).toBe("loading");
    expect(artwork.url.value).toBeNull();
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(findArtworkNode(root, "img")).toBeNull();

    decoding.resolve();
    await settleArtwork();
    expect(artwork.status.value).toBe("ready");
    expect(artwork.url.value).toBe("blob:artwork-1");
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-1");
  });

  it("无封面、请求失败和解码失败时进入 fallback", async () => {
    artworkRequest = async (trackId) => {
      if (trackId === 73) return null;
      if (trackId === 74) throw new Error("database unavailable");
      return { status: "available", mimeType: "image/png", data: [7, 8, 9] };
    };
    decodeImage = async () => {
      throw new Error("image decode failed");
    };

    const noArtwork = mountArtwork(73);
    const noArtworkRoot = mountArtworkComponent(ref(73));
    await settleArtwork();
    expect(noArtwork.artwork.status.value).toBe("fallback");
    expect(findArtworkNode(noArtworkRoot, "span")).not.toBeNull();

    const requestFailure = mountArtwork(74);
    const requestFailureRoot = mountArtworkComponent(ref(74));
    await settleArtwork();
    expect(requestFailure.artwork.status.value).toBe("fallback");
    expect(findArtworkNode(requestFailureRoot, "span")).not.toBeNull();

    const decodeFailure = mountArtwork(75);
    const decodeFailureRoot = mountArtworkComponent(ref(75));
    await settleArtwork();
    expect(decodeFailure.artwork.status.value).toBe("fallback");
    expect(decodeFailure.artwork.url.value).toBeNull();
    expect(findArtworkNode(decodeFailureRoot, "span")).not.toBeNull();
  });

  it("迟到的旧请求和旧解码结果不能覆盖新来源", async () => {
    const oldRequest = deferred<TrackArtwork | null>();
    const oldDecode = deferred<void>();
    artworkRequest = (trackId) =>
      trackId === 76
        ? oldRequest.promise
        : Promise.resolve({
            status: "available",
            mimeType: "image/png",
            data: [1],
          });
    decodeImage = () => (++decodeCount === 2 ? oldDecode.promise : Promise.resolve());
    const source = ref<number | null>(76);
    const { artwork } = mountArtwork(source);

    source.value = 77;
    await settleArtwork();
    expect(artwork.status.value).toBe("ready");
    expect(artwork.url.value).toBe("blob:artwork-1");

    oldRequest.resolve({ status: "available", mimeType: "image/png", data: [9] });
    await settleArtwork();
    expect(invokedTrackIds).toEqual([76, 77]);
    expect(artwork.url.value).toBe("blob:artwork-1");

    const decodingSource = ref<number | null>(78);
    const oldDecoderArtwork = mountArtwork(decodingSource);
    await settleArtwork();
    expect(oldDecoderArtwork.artwork.status.value).toBe("loading");

    decodingSource.value = 79;
    await settleArtwork();
    const currentUrl = oldDecoderArtwork.artwork.url.value;
    expect(currentUrl).toBe("blob:artwork-3");

    oldDecode.resolve();
    await settleArtwork();
    expect(oldDecoderArtwork.artwork.status.value).toBe("ready");
    expect(oldDecoderArtwork.artwork.url.value).toBe(currentUrl);
  });
});
