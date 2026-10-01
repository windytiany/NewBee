// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { effectScope, nextTick, ref } from "vue";
import type { EffectScope, MaybeRefOrGetter, Ref } from "vue";
import { useTrackInfo } from "@/playback/useTrackInfo";
import type { TrackInfoInvoker } from "@/playback/useTrackInfo";
import type { TrackArtwork, TrackDetails } from "@/types/track";

type TrackInfoCommand = "get_track" | "get_track_artwork";
type TrackInfoCall = { command: TrackInfoCommand; trackId: number };
type TrackInfoHandler = (command: TrackInfoCommand, trackId: number) => unknown | Promise<unknown>;
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

function createTrackDetails(id: number): TrackDetails {
  return {
    id,
    path: `/music/${id}.mp3`,
    title: `Track ${id}`,
    artist: `Artist ${id}`,
    album: `Album ${id}`,
    albumArtist: null,
    releaseDate: null,
    discNumber: null,
    trackNumber: null,
    durationMs: 180_000,
    codec: "mp3",
    sampleRateHz: 44_100,
    bitrateKbps: 320,
    channels: 2,
  };
}

function createArtwork(byte = 1): TrackArtwork {
  return { status: "available", mimeType: "image/png", data: [byte] };
}

function createInvoker(handler: TrackInfoHandler, calls: TrackInfoCall[]): TrackInfoInvoker {
  return async <Result>(command: TrackInfoCommand, args: { trackId: number }) => {
    calls.push({ command, trackId: args.trackId });
    return (await handler(command, args.trackId)) as Result;
  };
}

const scopes: EffectScope[] = [];
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
let createdUrls: string[];
let revokedUrls: string[];
let nextObjectUrl: number;

function mountTrackInfo(trackId: MaybeRefOrGetter<number | null>, invoke: TrackInfoInvoker) {
  const scope = effectScope();
  let trackInfo!: ReturnType<typeof useTrackInfo>;
  scope.run(() => {
    trackInfo = useTrackInfo(trackId, invoke);
  });
  scopes.push(scope);
  return { trackInfo, scope };
}

async function settleRequests() {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
}

function restoreDescriptor(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

beforeEach(() => {
  createdUrls = [];
  revokedUrls = [];
  nextObjectUrl = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => {
      const url = `blob:track-info-${++nextObjectUrl}`;
      createdUrls.push(url);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => revokedUrls.push(url),
  });
});

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  restoreDescriptor(URL, "createObjectURL", originalCreateObjectURL);
  restoreDescriptor(URL, "revokeObjectURL", originalRevokeObjectURL);
});

describe("useTrackInfo", () => {
  it("独立加载详情和封面", async () => {
    const detailsRequest = deferred<TrackDetails | null>();
    const artworkRequest = deferred<TrackArtwork | null>();
    const calls: TrackInfoCall[] = [];
    const invoke = createInvoker(
      (command) => (command === "get_track" ? detailsRequest.promise : artworkRequest.promise),
      calls,
    );
    const { trackInfo } = mountTrackInfo(ref<number | null>(41), invoke);

    expect(calls).toEqual([
      { command: "get_track", trackId: 41 },
      { command: "get_track_artwork", trackId: 41 },
    ]);
    expect(trackInfo.isLoading.value).toBe(true);

    detailsRequest.resolve(createTrackDetails(41));
    await settleRequests();
    expect(trackInfo.currentTrackDetails.value?.id).toBe(41);
    expect(trackInfo.isLoading.value).toBe(false);
    expect(trackInfo.currentTrackArtworkUrl.value).toBeNull();
    expect(trackInfo.currentTrackArtworkError.value).toBe("");

    artworkRequest.resolve(createArtwork());
    await settleRequests();
    expect(trackInfo.currentTrackArtworkUrl.value).toBe("blob:track-info-1");
    expect(trackInfo.currentTrackDetailsError.value).toBe("");
    expect(revokedUrls).toEqual([]);
  });

  it("快速切歌后忽略旧请求，并在清空曲目时清除状态", async () => {
    const requests = new Map<
      number,
      { details: Deferred<TrackDetails | null>; artwork: Deferred<TrackArtwork | null> }
    >();
    const calls: TrackInfoCall[] = [];
    const invoke = createInvoker((command, trackId) => {
      let request = requests.get(trackId);
      if (!request) {
        request = { details: deferred(), artwork: deferred() };
        requests.set(trackId, request);
      }
      return command === "get_track" ? request.details.promise : request.artwork.promise;
    }, calls);
    const currentTrackId = ref<number | null>(51);
    const { trackInfo } = mountTrackInfo(currentTrackId, invoke);

    currentTrackId.value = 52;
    requests.get(52)?.details.resolve(createTrackDetails(52));
    requests.get(52)?.artwork.resolve(createArtwork(2));
    await settleRequests();
    expect(trackInfo.currentTrackDetails.value?.id).toBe(52);
    expect(trackInfo.currentTrackArtworkUrl.value).toBe("blob:track-info-1");
    expect(trackInfo.isLoading.value).toBe(false);

    requests.get(51)?.details.resolve(createTrackDetails(51));
    requests.get(51)?.artwork.resolve(createArtwork(1));
    await settleRequests();
    expect(trackInfo.currentTrackDetails.value?.id).toBe(52);
    expect(trackInfo.currentTrackArtworkUrl.value).toBe("blob:track-info-1");
    expect(createdUrls).toEqual(["blob:track-info-1"]);
    expect(calls.map(({ trackId }) => trackId)).toEqual([51, 51, 52, 52]);

    currentTrackId.value = null;
    expect(trackInfo.currentTrackDetails.value).toBeNull();
    expect(trackInfo.currentTrackArtworkUrl.value).toBeNull();
    expect(trackInfo.isLoading.value).toBe(false);
    expect(revokedUrls).toEqual(["blob:track-info-1"]);
  });

  it("拒绝与请求 trackId 不匹配的详情", async () => {
    const calls: TrackInfoCall[] = [];
    const invoke = createInvoker(
      (command) => (command === "get_track" ? createTrackDetails(62) : { status: "noArtwork" }),
      calls,
    );
    const { trackInfo } = mountTrackInfo(61, invoke);

    await settleRequests();

    expect(trackInfo.currentTrackDetails.value).toBeNull();
    expect(trackInfo.currentTrackDetailsError.value).toBe("返回的曲目详情与当前播放曲目不匹配。");
    expect(trackInfo.isLoading.value).toBe(false);
    expect(trackInfo.currentTrackArtworkError.value).toBe("");
  });

  it("分别报告详情与封面请求错误", async () => {
    const calls: TrackInfoCall[] = [];
    const invoke = createInvoker((command) => {
      throw new Error(command === "get_track" ? "database unavailable" : "artwork unavailable");
    }, calls);
    const { trackInfo } = mountTrackInfo(71, invoke);

    await settleRequests();

    expect(trackInfo.currentTrackDetailsError.value).toBe("读取曲目详情失败：database unavailable");
    expect(trackInfo.currentTrackArtworkError.value).toBe(
      "读取封面失败，已显示占位图：artwork unavailable",
    );
    expect(trackInfo.isLoading.value).toBe(false);
  });

  it("格式化非 Error 拒绝值", async () => {
    const calls: TrackInfoCall[] = [];
    const invoke = createInvoker(() => Promise.reject("backend unavailable"), calls);
    const { trackInfo } = mountTrackInfo(72, invoke);

    await settleRequests();

    expect(trackInfo.currentTrackDetailsError.value).toBe("读取曲目详情失败：backend unavailable");
    expect(trackInfo.currentTrackArtworkError.value).toBe(
      "读取封面失败，已显示占位图：backend unavailable",
    );
  });

  it("切歌和销毁 scope 时回收封面 Blob URL", async () => {
    const calls: TrackInfoCall[] = [];
    const invoke = createInvoker((command, trackId) => {
      return command === "get_track" ? createTrackDetails(trackId) : createArtwork(trackId);
    }, calls);
    const currentTrackId: Ref<number | null> = ref(81);
    const { trackInfo, scope } = mountTrackInfo(currentTrackId, invoke);

    await settleRequests();
    expect(trackInfo.currentTrackArtworkUrl.value).toBe("blob:track-info-1");

    currentTrackId.value = 82;
    expect(revokedUrls).toEqual(["blob:track-info-1"]);
    await settleRequests();
    expect(trackInfo.currentTrackArtworkUrl.value).toBe("blob:track-info-2");

    scope.stop();
    expect(revokedUrls).toEqual(["blob:track-info-1", "blob:track-info-2"]);
  });
});
