import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { nextTick } from "vue";
import { createArtworkResource } from "@/features/artwork/resources";
import type { ArtworkResourceSnapshot } from "@/features/artwork/resources";
import type { TrackArtwork } from "@/features/artwork/types";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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
const releases: Array<() => void> = [];
let images: TestImage[];
let revoked: string[];
let created: number;
let decode: () => Promise<void>;
const content: TrackArtwork = new Uint8Array([1, 2, 3]).buffer;

class TestImage {
  src = "";
  constructor() {
    images.push(this);
  }
  decode() {
    return decode();
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

beforeEach(() => {
  images = [];
  revoked = [];
  created = 0;
  decode = () => Promise.resolve();
  for (const [target, key, value] of [
    [globalThis, "Image", TestImage],
    [URL, "createObjectURL", () => `blob:resource-${++created}`],
    [URL, "revokeObjectURL", (url: string) => revoked.push(url)],
  ] as const) {
    Object.defineProperty(target, key, { configurable: true, value });
  }
});

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await settle();
  for (const { target, key, descriptor } of originals) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
}

function fixture() {
  const requests: Array<ReturnType<typeof deferred<TrackArtwork>>> = [];
  const errors: unknown[] = [];
  const resource = createArtworkResource(
    () => {
      const request = deferred<TrackArtwork>();
      requests.push(request);
      return request.promise;
    },
    (error) => {
      errors.push(error);
      return `读取失败：${String(error)}`;
    },
  );
  function subscribe() {
    const snapshots: ArtworkResourceSnapshot[] = [];
    const unsubscribe = resource.subscribe((snapshot) => snapshots.push(snapshot));
    releases.push(unsubscribe);
    return { snapshots, unsubscribe };
  }
  function request(index: number) {
    const value = requests[index];
    if (!value) throw new Error("Missing resource request");
    return value;
  }
  function retain() {
    const image = resource.snapshot.image;
    if (!image) throw new Error("Missing decoded resource");
    const release = image.retain();
    releases.push(release);
    return release;
  }
  return { resource, requests, request, subscribe, retain, errors };
}

describe("封面资源生命周期", () => {
  it("订阅共享请求和解码，解码完成才发布 ready，最后离开才释放", async () => {
    const decoding = deferred<void>();
    decode = () => decoding.promise;
    const { resource, request, requests, subscribe } = fixture();
    const first = subscribe();
    const second = subscribe();
    expect(requests).toHaveLength(1);
    request(0).resolve(content);
    await settle();
    expect(resource.snapshot.status).toBe("loading");
    expect(images).toHaveLength(1);
    decoding.resolve();
    await settle();
    expect(first.snapshots[first.snapshots.length - 1]).toBe(
      second.snapshots[second.snapshots.length - 1],
    );
    expect(resource.snapshot.image?.content).toBe(content);
    first.unsubscribe();
    await settle();
    expect(revoked).toEqual([]);
    second.unsubscribe();
    expect(images[0]?.src).toBe("");
    expect(revoked).toEqual([]);
    await settle();
    expect(revoked).toEqual(["blob:resource-1"]);
  });

  it("曲目订阅可以在最后离开时立即释放，重复离开不重复撤销", async () => {
    const { request, subscribe } = fixture();
    const { unsubscribe } = subscribe();
    request(0).resolve(content);
    await settle();
    unsubscribe(false);
    unsubscribe(false);
    expect(revoked).toEqual(["blob:resource-1"]);
  });

  it("空内容回退，不分配图片资源或报告错误", async () => {
    const { resource, request, subscribe, errors } = fixture();
    subscribe();
    request(0).resolve(new ArrayBuffer(0));
    await settle();
    expect(resource.snapshot).toEqual({ status: "fallback", image: null, error: "" });
    expect(created).toBe(0);
    expect(images).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("读取失败交给业务格式化错误，失败结果无 URL", async () => {
    const { resource, request, subscribe, errors } = fixture();
    subscribe();
    request(0).reject("unavailable");
    await settle();
    expect(resource.snapshot).toEqual({
      status: "fallback",
      image: null,
      error: "读取失败：unavailable",
    });
    expect(errors).toEqual(["unavailable"]);
    expect(created).toBe(0);
  });

  it("解码失败立即释放 URL 并清除解码图片", async () => {
    decode = () => Promise.reject(new Error("invalid image"));
    const { resource, request, subscribe } = fixture();
    subscribe();
    request(0).resolve(content);
    await settle();
    expect(resource.snapshot.status).toBe("fallback");
    expect(resource.snapshot.image).toBeNull();
    expect(resource.snapshot.error).toContain("invalid image");
    expect(images[0]?.src).toBe("");
    expect(revoked).toEqual(["blob:resource-1"]);
  });

  it("刷新忽略迟到的读取，不分配过期 URL", async () => {
    const { resource, request, subscribe } = fixture();
    subscribe();
    resource.reload();
    request(1).resolve(content);
    await settle();
    const ready = resource.snapshot;
    request(0).resolve(new Uint8Array([9]).buffer);
    await settle();
    expect(resource.snapshot).toBe(ready);
    expect(created).toBe(1);
  });

  it("刷新取消旧解码，迟到成功不能覆盖新图", async () => {
    const decoding = deferred<void>();
    decode = () => decoding.promise;
    const { resource, request, subscribe } = fixture();
    subscribe();
    request(0).resolve(content);
    await settle();
    resource.reload();
    expect(resource.snapshot.status).toBe("loading");
    decode = () => Promise.resolve();
    request(1).resolve(new Uint8Array([9]).buffer);
    await settle();
    const ready = resource.snapshot;
    decoding.resolve();
    await settle();
    expect(resource.snapshot).toBe(ready);
    expect(resource.snapshot.image?.url).toBe("blob:resource-2");
    expect(images[0]?.src).toBe("");
    expect(revoked).toEqual(["blob:resource-1"]);
  });

  it("离开后迟到的读取不会分配资源，过期失败也不报告", async () => {
    const { resource, request, subscribe, errors } = fixture();
    subscribe();
    resource.reload();
    releases[0]?.();
    request(0).reject("stale error");
    request(1).resolve(content);
    await settle();
    expect(created).toBe(0);
    expect(resource.snapshot.status).toBe("fallback");
    expect(errors).toEqual([]);
  });

  it("离开时释放尚未解码的 URL，迟到解码失败不报告或重复撤销", async () => {
    const decoding = deferred<void>();
    decode = () => decoding.promise;
    const { resource, request, subscribe, errors } = fixture();
    const { unsubscribe } = subscribe();
    request(0).resolve(content);
    await settle();
    unsubscribe();
    await settle();
    expect(images[0]?.src).toBe("");
    expect(revoked).toEqual(["blob:resource-1"]);
    decoding.reject(new Error("cancelled"));
    await settle();
    expect(resource.snapshot.status).toBe("fallback");
    expect(errors).toEqual([]);
    expect(revoked).toEqual(["blob:resource-1"]);
  });

  it("已保留图片跨刷新和最后订阅离开存活，最后释放才撤销", async () => {
    const { resource, request, subscribe, retain, requests } = fixture();
    const { unsubscribe } = subscribe();
    request(0).resolve(content);
    await settle();
    const releaseFirst = retain();
    const releaseSecond = retain();
    expect(requests).toHaveLength(1);
    resource.reload();
    request(1).resolve(new Uint8Array([9]).buffer);
    await settle();
    unsubscribe(false);
    expect(revoked).toEqual(["blob:resource-2"]);
    releaseFirst();
    releaseFirst();
    expect(revoked).toEqual(["blob:resource-2"]);
    releaseSecond();
    expect(revoked).toEqual(["blob:resource-2", "blob:resource-1"]);
  });

  it("保留仅保护 URL，不让无订阅资源继续加载", async () => {
    const { resource, request, requests, subscribe, retain } = fixture();
    const { unsubscribe } = subscribe();
    request(0).resolve(content);
    await settle();
    const release = retain();
    unsubscribe(false);
    resource.reload();
    expect(requests).toHaveLength(1);
    expect(revoked).toEqual([]);
    release();
    expect(revoked).toEqual(["blob:resource-1"]);
  });
});
