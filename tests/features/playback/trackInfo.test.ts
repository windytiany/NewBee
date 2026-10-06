import { afterEach, describe, expect, it } from "bun:test";
import { effectScope, nextTick, ref } from "vue";
import type { EffectScope, MaybeRefOrGetter } from "vue";
import { useTrackDetails } from "@/features/playback/composables/useTrackDetails";
import type { TrackDetailsInvoker } from "@/features/playback/composables/useTrackDetails";
import type { TrackDetails } from "@/features/library/types";

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
};

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
    discTotal: null,
    trackTotal: null,
    durationMs: 180_000,
    codec: "mp3",
    sampleRateHz: 44_100,
    bitrateKbps: 320,
    channels: 2,
  };
}

function createInvoker(
  handler: (trackId: number) => unknown | Promise<unknown>,
  calls: number[] = [],
): TrackDetailsInvoker {
  return async <Result>(_command: "get_track", args: { trackId: number }) => {
    calls.push(args.trackId);
    return (await handler(args.trackId)) as Result;
  };
}

const scopes: EffectScope[] = [];

function mountTrackInfo(trackId: MaybeRefOrGetter<number | null>, invoke: TrackDetailsInvoker) {
  const scope = effectScope();
  let trackInfo!: ReturnType<typeof useTrackDetails>;
  scope.run(() => {
    trackInfo = useTrackDetails(trackId, invoke);
  });
  scopes.push(scope);
  return { trackInfo, scope };
}

async function settleRequests() {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
});

describe("useTrackDetails", () => {
  it("加载详情，不再单独请求封面", async () => {
    const request = deferred<TrackDetails | null>();
    const calls: number[] = [];
    const { trackInfo } = mountTrackInfo(
      ref(41),
      createInvoker(() => request.promise, calls),
    );
    expect(calls).toEqual([41]);
    expect(trackInfo.isLoading.value).toBe(true);

    request.resolve(createTrackDetails(41));
    await settleRequests();
    expect(trackInfo.currentTrackDetails.value?.id).toBe(41);
    expect(trackInfo.isLoading.value).toBe(false);
    expect(trackInfo.currentTrackDetailsError.value).toBe("");
  });

  it("快速切歌后忽略旧详情，并在清空曲目时清除状态", async () => {
    const requests = new Map<number, Deferred<TrackDetails | null>>();
    const calls: number[] = [];
    const invoke = createInvoker((trackId) => {
      const request = deferred<TrackDetails | null>();
      requests.set(trackId, request);
      return request.promise;
    }, calls);
    const source = ref<number | null>(51);
    const { trackInfo } = mountTrackInfo(source, invoke);

    source.value = 52;
    requests.get(52)?.resolve(createTrackDetails(52));
    await settleRequests();
    requests.get(51)?.resolve(createTrackDetails(51));
    await settleRequests();
    expect(trackInfo.currentTrackDetails.value?.id).toBe(52);
    expect(trackInfo.isLoading.value).toBe(false);
    expect(calls).toEqual([51, 52]);

    source.value = null;
    expect(trackInfo.currentTrackDetails.value).toBeNull();
    expect(trackInfo.isLoading.value).toBe(false);
    expect(trackInfo.currentTrackDetailsError.value).toBe("");
  });

  it("拒绝与请求 trackId 不匹配的详情", async () => {
    const { trackInfo } = mountTrackInfo(
      61,
      createInvoker(() => createTrackDetails(62)),
    );
    await settleRequests();
    expect(trackInfo.currentTrackDetails.value).toBeNull();
    expect(trackInfo.currentTrackDetailsError.value).toBe("返回的曲目详情与当前播放曲目不匹配。");
    expect(trackInfo.isLoading.value).toBe(false);
  });

  it("未找到详情时报告错误", async () => {
    const { trackInfo } = mountTrackInfo(
      63,
      createInvoker(() => null),
    );
    await settleRequests();
    expect(trackInfo.currentTrackDetailsError.value).toBe("未找到正在播放曲目的详情。");
    expect(trackInfo.isLoading.value).toBe(false);
  });

  it("报告详情请求错误", async () => {
    const { trackInfo } = mountTrackInfo(
      71,
      createInvoker(() => {
        throw new Error("database unavailable");
      }),
    );
    await settleRequests();
    expect(trackInfo.currentTrackDetailsError.value).toBe("读取曲目详情失败");
    expect(trackInfo.isLoading.value).toBe(false);
  });

  it("格式化非 Error 拒绝值", async () => {
    const { trackInfo } = mountTrackInfo(
      72,
      createInvoker(() => Promise.reject("backend unavailable")),
    );
    await settleRequests();
    expect(trackInfo.currentTrackDetailsError.value).toBe("读取曲目详情失败");
  });

  it("销毁 scope 后忽略迟到的结果", async () => {
    const request = deferred<TrackDetails | null>();
    const { trackInfo, scope } = mountTrackInfo(
      81,
      createInvoker(() => request.promise),
    );
    scope.stop();
    request.resolve(createTrackDetails(81));
    await settleRequests();
    expect(trackInfo.currentTrackDetails.value).toBeNull();
  });
});
