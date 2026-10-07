import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { loadSourceModules } from "../../support/moduleLoader";
import * as backgroundModule from "@/features/artwork/background";
import type { AlbumArtworkSelection } from "@/features/artwork/useAlbumArtwork";
import type { TrackArtwork } from "@/features/artwork/types";

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalCreateUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
const scopes: Vue.EffectScope[] = [];
const requests: Array<ReturnType<typeof deferred<TrackArtwork>>> = [];
let invokedSelections: AlbumArtworkSelection[];
let revokedUrls: string[];
let createdUrls: number;
let canvasCount: number;
let canvasAvailable: boolean;
let decodeImage: () => Promise<void>;
let images: TestImage[];

class TestImage {
  src = "";
  constructor() {
    images.push(this);
  }
  decode() {
    return decodeImage();
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

const dependencies: Record<string, unknown> = {
  vue: Vue,
  "@/features/artwork/background": backgroundModule,
  "@tauri-apps/api/core": {
    invoke(command: string, selection: AlbumArtworkSelection) {
      expect(command).toBe("get_album_artwork");
      invokedSelections.push(selection);
      const request = deferred<TrackArtwork>();
      requests.push(request);
      return request.promise;
    },
  },
};
await loadSourceModules(["features/artwork/useAlbumArtwork.ts"], dependencies);
const { useAlbumArtwork, invalidateAlbumArtworkCache } = dependencies[
  "@/features/artwork/useAlbumArtwork"
] as typeof import("@/features/artwork/useAlbumArtwork");
const available: TrackArtwork = new Uint8Array([1, 2, 3]).buffer;
const album = { albumArtist: "Artist", album: "Album" };

function subscribe(
  selection: AlbumArtworkSelection | Vue.Ref<AlbumArtworkSelection | null> = album,
  purpose: "cover" | "background" = "cover",
) {
  const scope = Vue.effectScope();
  scopes.push(scope);
  const artwork = scope.run(() => useAlbumArtwork(selection, purpose));
  if (!artwork) throw new Error("Missing artwork subscription");
  return { artwork, dispose: () => scope.stop() };
}

function requestAt(index: number) {
  const request = requests[index];
  if (!request) throw new Error("Missing artwork request");
  return request;
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Vue.nextTick();
  await Promise.resolve();
}

beforeEach(() => {
  requests.length = 0;
  invokedSelections = [];
  revokedUrls = [];
  createdUrls = 0;
  canvasCount = 0;
  canvasAvailable = true;
  images = [];
  decodeImage = () => Promise.resolve();
  Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => `blob:album-${++createdUrls}`,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => revokedUrls.push(url),
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement(tag: string) {
        expect(tag).toBe("canvas");
        canvasCount++;
        return {
          width: 0,
          height: 0,
          getContext() {
            if (!canvasAvailable) return null;
            return {
              drawImage() {},
              getImageData() {
                return { data: new Uint8ClampedArray(32 * 32 * 4).fill(255) };
              },
              putImageData() {},
            };
          },
          toDataURL: () => "data:image/png;base64,background",
        };
      },
    },
  });
});

afterEach(async () => {
  for (const scope of scopes.splice(0)) scope.stop();
  await settle();
  for (const [target, key, descriptor] of [
    [globalThis, "Image", originalImage],
    [globalThis, "document", originalDocument],
    [URL, "createObjectURL", originalCreateUrl],
    [URL, "revokeObjectURL", originalRevokeUrl],
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});

describe("共享专辑封面和背景", () => {
  it("卡片与展开区共享请求、解码和背景，只在最后订阅释放时撤销 URL", async () => {
    const card = subscribe();
    const detail = subscribe(album, "background");
    expect(invokedSelections).toEqual([album]);
    requestAt(0).resolve(available);
    await settle();
    expect(card.artwork.status.value).toBe("ready");
    expect(card.artwork.url.value).toBe(detail.artwork.url.value);
    expect(images).toHaveLength(1);
    expect(canvasCount).toBe(1);
    expect(detail.artwork.background.value).toEqual({
      imageUrl: "data:image/png;base64,background",
      color: "rgb(102, 102, 102)",
    });
    detail.dispose();
    await settle();
    expect(revokedUrls).toEqual([]);
    card.dispose();
    await settle();
    expect(revokedUrls).toEqual(["blob:album-1"]);
    expect(images[0]?.src).toBe("");
  });

  it("卡片不生成背景，展开时才生成一次，重复展开复用结果", async () => {
    subscribe();
    requestAt(0).resolve(available);
    await settle();
    expect(canvasCount).toBe(0);
    const detail = subscribe(album, "background");
    expect(canvasCount).toBe(1);
    detail.dispose();
    const reopened = subscribe(album, "background");
    expect(canvasCount).toBe(1);
    expect(invokedSelections).toHaveLength(1);
    expect(reopened.artwork.background.value).not.toBeNull();
  });

  it("无订阅的缓存被释放，重新进入会重新请求", async () => {
    const first = subscribe();
    requestAt(0).resolve(available);
    await settle();
    first.dispose();
    await settle();
    const second = subscribe();
    expect(second.artwork.status.value).toBe("loading");
    expect(invokedSelections).toHaveLength(2);
    expect(revokedUrls).toEqual(["blob:album-1"]);
  });

  it("无封面时正常回退，不创建 URL 或画布", async () => {
    const { artwork } = subscribe(album, "background");
    requestAt(0).resolve(new ArrayBuffer(0));
    await settle();
    expect(artwork.status.value).toBe("fallback");
    expect(artwork.background.value).toBeNull();
    expect(artwork.error.value).toBe("");
    expect(createdUrls).toBe(0);
    expect(canvasCount).toBe(0);
  });

  it("读取失败保留错误上下文并回退", async () => {
    const { artwork } = subscribe();
    requestAt(0).reject(new Error("IPC unavailable"));
    await settle();
    expect(artwork.status.value).toBe("fallback");
    expect(artwork.error.value).toContain("IPC unavailable");
  });

  it("解码失败释放 URL 并回退", async () => {
    decodeImage = () => Promise.reject(new Error("Invalid image"));
    const { artwork } = subscribe(album, "background");
    requestAt(0).resolve(available);
    await settle();
    expect(artwork.status.value).toBe("fallback");
    expect(artwork.error.value).toContain("Invalid image");
    expect(artwork.url.value).toBeNull();
    expect(revokedUrls).toEqual(["blob:album-1"]);
    expect(canvasCount).toBe(0);
  });

  it("背景生成失败不影响封面，保留错误并使用默认背景", async () => {
    canvasAvailable = false;
    const { artwork } = subscribe(album, "background");
    requestAt(0).resolve(available);
    await settle();
    expect(artwork.status.value).toBe("ready");
    expect(artwork.url.value).toBe("blob:album-1");
    expect(artwork.background.value).toBeNull();
    expect(artwork.error.value).toContain("Canvas 2D");
  });

  it("快速切换专辑时旧请求不能覆盖新封面和背景", async () => {
    const selection = Vue.ref<AlbumArtworkSelection | null>(album);
    const { artwork } = subscribe(selection, "background");
    selection.value = { albumArtist: "Artist", album: "Second" };
    requestAt(1).resolve(available);
    await settle();
    const currentBackground = artwork.background.value;
    requestAt(0).resolve(available);
    await settle();
    expect(artwork.url.value).toBe("blob:album-1");
    expect(artwork.background.value).toBe(currentBackground);
    expect(createdUrls).toBe(1);
    selection.value = null;
    expect(artwork.status.value).toBe("fallback");
    expect(artwork.background.value).toBeNull();
    await settle();
    expect(revokedUrls).toEqual(["blob:album-1"]);
  });

  it("解码尚未完成时卸载仍会释放 URL，不发布过期结果", async () => {
    const decode = deferred<void>();
    decodeImage = () => decode.promise;
    const { artwork, dispose } = subscribe(album, "background");
    requestAt(0).resolve(available);
    await settle();
    expect(artwork.status.value).toBe("loading");
    dispose();
    await settle();
    decode.resolve();
    await settle();
    expect(revokedUrls).toEqual(["blob:album-1"]);
    expect(canvasCount).toBe(0);
    expect(artwork.status.value).toBe("loading");
  });

  it("写入后刷新订阅封面及背景，过期请求不能覆盖刷新结果", async () => {
    const { artwork } = subscribe(album, "background");
    invalidateAlbumArtworkCache();
    requestAt(1).resolve(available);
    await settle();
    expect(artwork.url.value).toBe("blob:album-1");
    requestAt(0).resolve(available);
    await settle();
    expect(createdUrls).toBe(1);
    invalidateAlbumArtworkCache();
    expect(artwork.status.value).toBe("loading");
    expect(artwork.background.value).toBeNull();
    requestAt(2).resolve(available);
    await settle();
    expect(artwork.url.value).toBe("blob:album-2");
    expect(canvasCount).toBe(2);
    expect(revokedUrls).toContain("blob:album-1");
  });

  it("同名专辑使用演出者区分缓存，null 和字符串也不冲突", () => {
    subscribe({ albumArtist: "First", album: "Album" });
    subscribe({ albumArtist: "Second", album: "Album" });
    subscribe({ albumArtist: null, album: null });
    subscribe({ albumArtist: "null", album: "null" });
    expect(invokedSelections).toHaveLength(4);
  });
});
