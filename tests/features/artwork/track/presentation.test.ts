import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { effectScope, nextTick, ref } from "vue";
import type { Ref } from "vue";
import type { TrackArtwork } from "@/features/artwork/types";
import { loadSourceModules } from "../../../support/module/loader";

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
};

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

const originals = (
  [
    [globalThis, "Image"],
    [URL, "createObjectURL"],
    [URL, "revokeObjectURL"],
  ] as const
).map(([target, key]) => ({
  target,
  key,
  descriptor: Object.getOwnPropertyDescriptor(target, key),
}));
const scopes: Vue.EffectScope[] = [];

async function settleArtwork() {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
    await nextTick();
  }
}

afterEach(async () => {
  for (const scope of scopes.splice(0)) scope.stop();
  await settleArtwork();
  for (const { target, key, descriptor } of originals) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});

async function createPresentationFixture({
  load = async (trackId: number): Promise<TrackArtwork> => new Uint8Array([trackId]).buffer,
  decode = async (): Promise<void> => {},
}: {
  load?: (trackId: number) => Promise<TrackArtwork>;
  decode?: () => Promise<void>;
} = {}) {
  const revokedUrls: string[] = [];
  const createdUrls: string[] = [];
  const requests: Array<{ trackId: number; size: number | null }> = [];
  class TestImage {
    src = "";
    decode() {
      return decode();
    }
    removeAttribute(name: string) {
      if (name === "src") this.src = "";
    }
  }
  for (const [target, key, value] of [
    [globalThis, "Image", TestImage],
    [
      URL,
      "createObjectURL",
      () => {
        const url = `blob:presentation-${createdUrls.length + 1}`;
        createdUrls.push(url);
        return url;
      },
    ],
    [URL, "revokeObjectURL", (url: string) => revokedUrls.push(url)],
  ] as const) {
    Object.defineProperty(target, key, { configurable: true, value });
  }
  const dependencies: Record<string, unknown> = {
    vue: Vue,
    "@tauri-apps/api/core": {
      invoke: (command: string, args: { trackId: number; size: number | null }) => {
        expect(command).toBe("get_track_artwork");
        requests.push(args);
        return load(args.trackId);
      },
    },
  };
  await loadSourceModules(
    [
      "features/artwork/resources.ts",
      "features/artwork/useTrackArtwork.ts",
      "features/artwork/useTrackArtworkPresentation.ts",
    ],
    dependencies,
  );
  const { useTrackArtworkPresentation } = dependencies[
    "@/features/artwork/useTrackArtworkPresentation"
  ] as typeof import("@/features/artwork/useTrackArtworkPresentation");
  const { invalidateTrackArtworkCache } = dependencies[
    "@/features/artwork/useTrackArtwork"
  ] as typeof import("@/features/artwork/useTrackArtwork");

  function mount(trackId: Ref<number | null>, size: number | null = null) {
    const scope = effectScope();
    scopes.push(scope);
    const presentation = scope.run(() => useTrackArtworkPresentation(trackId, size));
    if (!presentation) throw new Error("Artwork presentation scope did not start");
    return { presentation, dispose: () => scope.stop() };
  }
  return { mount, invalidate: invalidateTrackArtworkCache, requests, createdUrls, revokedUrls };
}

describe("曲目封面展示资源生命周期", () => {
  it("同图异曲保留旧 URL 与 key，直到最终离场 release 才回收", async () => {
    const fixture = await createPresentationFixture({
      load: async (trackId) => new Uint8Array([trackId === 3 ? 9 : 4, 5, 6]).buffer,
    });
    const trackId = ref<number | null>(1);
    const { presentation } = fixture.mount(trackId, 128);
    await settleArtwork();
    const first = presentation.present(false);
    expect(first).toEqual({
      key: first.key,
      status: "ready",
      url: fixture.createdUrls[0],
      error: "",
    });

    trackId.value = 2;
    await settleArtwork();
    expect(presentation.url.value).toBe(fixture.createdUrls[1]!);
    const same = presentation.present(false);
    expect(same).toEqual(first);
    expect(presentation.present(false)).toEqual(first);
    expect(fixture.revokedUrls).toEqual([]);

    trackId.value = 3;
    await settleArtwork();
    const different = presentation.present(false);
    expect(different.key).not.toBe(first.key);
    expect(different.url).toBe(fixture.createdUrls[2]!);
    expect(fixture.revokedUrls).toEqual([fixture.createdUrls[1]!]);
    presentation.release(first.key);
    presentation.release(first.key);
    expect(fixture.revokedUrls).toEqual([fixture.createdUrls[1]!, first.url!]);
    expect(fixture.requests).toEqual([1, 2, 3].map((id) => ({ trackId: id, size: 128 })));
  });

  it("不同图切换后旧 URL 保留到对应 release，重复 release 不影响当前图", async () => {
    const fixture = await createPresentationFixture();
    const trackId = ref<number | null>(1);
    const { presentation } = fixture.mount(trackId);
    await settleArtwork();
    const first = presentation.present(false);
    trackId.value = 2;
    await settleArtwork();
    const second = presentation.present(false);
    expect(second.key).not.toBe(first.key);
    expect(second.url).not.toBe(first.url);
    expect(fixture.revokedUrls).toEqual([]);
    presentation.release(first.key);
    presentation.release(first.key);
    presentation.release(-1);
    expect(fixture.revokedUrls).toEqual([first.url!]);
    expect(presentation.url.value).toBe(second.url);
  });

  it("取消解码中的切换不会展示迟到结果，release 与卸载均幂等", async () => {
    const decoding = deferred<void>();
    let decodeCount = 0;
    const fixture = await createPresentationFixture({
      decode: () => (++decodeCount === 2 ? decoding.promise : Promise.resolve()),
    });
    const trackId = ref<number | null>(1);
    const { presentation, dispose } = fixture.mount(trackId);
    await settleArtwork();
    const first = presentation.present(false);
    trackId.value = 2;
    await settleArtwork();
    expect(presentation.status.value).toBe("loading");
    expect(presentation.url.value).toBeNull();
    trackId.value = null;
    await settleArtwork();
    const cancelled = presentation.present(false);
    expect(cancelled.status).toBe("fallback");
    expect(cancelled.url).toBeNull();
    expect(fixture.revokedUrls).toEqual([fixture.createdUrls[1]!]);
    decoding.resolve();
    await settleArtwork();
    expect(presentation.present(false)).toEqual(cancelled);
    presentation.release(first.key);
    presentation.release(first.key);
    dispose();
    dispose();
    await settleArtwork();
    expect(new Set(fixture.revokedUrls)).toEqual(new Set(fixture.createdUrls));
    expect(fixture.revokedUrls).toHaveLength(2);
  });

  it("详情 pending 时调用方等待 ready 再 present，未展示的新图不会被提前保留", async () => {
    const fixture = await createPresentationFixture();
    const detailsPending = ref(false);
    const trackId = ref<number | null>(1);
    const { presentation } = fixture.mount(trackId);
    await settleArtwork();
    let displayed = presentation.present(false);
    const first = displayed;
    detailsPending.value = true;
    trackId.value = 2;
    await settleArtwork();
    expect(presentation.status.value).toBe("ready");
    if (!detailsPending.value && presentation.status.value !== "loading") {
      displayed = presentation.present(false);
    }
    expect(displayed).toEqual(first);
    expect(fixture.revokedUrls).toEqual([]);

    trackId.value = 3;
    await settleArtwork();
    expect(fixture.revokedUrls).toEqual([fixture.createdUrls[1]!]);
    detailsPending.value = false;
    if (!detailsPending.value && presentation.status.value !== "loading") {
      displayed = presentation.present(false);
    }
    expect(displayed.url).toBe(fixture.createdUrls[2]!);
    expect(displayed.key).not.toBe(first.key);
    expect(fixture.revokedUrls).not.toContain(first.url!);
    presentation.release(first.key);
    expect(fixture.revokedUrls).toContain(first.url!);
  });

  it("pending 展示只返回 loading，ready 后沿用 key 且不重复保留", async () => {
    const request = deferred<TrackArtwork>();
    const fixture = await createPresentationFixture({ load: () => request.promise });
    const { presentation, dispose } = fixture.mount(ref(1));
    const pending = presentation.present(true);
    expect(pending).toEqual({ key: pending.key, status: "loading", url: null, error: "" });
    expect(presentation.status.value).toBe("loading");
    request.resolve(new Uint8Array([1]).buffer);
    await settleArtwork();
    const ready = presentation.present(false);
    expect(ready.key).toBe(pending.key);
    expect(ready.status).toBe("ready");
    expect(presentation.present(false)).toEqual(ready);
    dispose();
    await settleArtwork();
    expect(fixture.revokedUrls).toEqual([ready.url!]);
  });

  it("卸载释放当前和所有仍未离场的图片，后续 release 无副作用", async () => {
    const fixture = await createPresentationFixture();
    const trackId = ref<number | null>(1);
    const { presentation, dispose } = fixture.mount(trackId);
    const keys: number[] = [];
    for (const id of [1, 2, 3]) {
      trackId.value = id;
      await settleArtwork();
      keys.push(presentation.present(false).key);
    }
    expect(fixture.revokedUrls).toEqual([]);
    dispose();
    await settleArtwork();
    expect(new Set(fixture.revokedUrls)).toEqual(new Set(fixture.createdUrls));
    expect(fixture.revokedUrls).toHaveLength(3);
    for (const key of keys) presentation.release(key);
    dispose();
    await settleArtwork();
    expect(fixture.revokedUrls).toHaveLength(3);
  });

  for (const sameArtwork of [true, false]) {
    it(`invalidate 后${sameArtwork ? "同图保持旧展示" : "不同图等待旧图 release"}`, async () => {
      let loads = 0;
      const fixture = await createPresentationFixture({
        load: async () => new Uint8Array([sameArtwork ? 1 : ++loads]).buffer,
      });
      const { presentation, dispose } = fixture.mount(ref(1));
      await settleArtwork();
      const first = presentation.present(false);
      fixture.invalidate([1]);
      expect(presentation.status.value).toBe("loading");
      expect(presentation.url.value).toBeNull();
      await settleArtwork();
      const refreshed = presentation.present(false);
      expect(presentation.url.value).toBe(fixture.createdUrls[1]!);
      expect(fixture.revokedUrls).toEqual([]);
      if (sameArtwork) {
        expect(refreshed).toEqual(first);
      } else {
        expect(refreshed.key).not.toBe(first.key);
        expect(refreshed.url).toBe(fixture.createdUrls[1]!);
      }
      presentation.release(first.key);
      expect(fixture.revokedUrls).toEqual([first.url!]);
      dispose();
      await settleArtwork();
      expect(new Set(fixture.revokedUrls)).toEqual(new Set(fixture.createdUrls));
      expect(fixture.revokedUrls).toHaveLength(2);
    });
  }
});
