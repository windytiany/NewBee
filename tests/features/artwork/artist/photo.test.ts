import { afterEach, beforeEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { evaluateSource, transpileScript } from "../../../support/module/loader";
import type * as Photo from "@/features/artwork/artist/usePhoto";

const source = await Bun.file("src/features/artwork/artist/usePhoto.ts").text();
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
let created: number;
let revoked: string[];

beforeEach(() => {
  created = 0;
  revoked = [];
  class TestImage {
    src = "";
    decode() {
      return Promise.resolve();
    }
    removeAttribute() {
      this.src = "";
    }
  }
  Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => `blob:photo-${++created}`,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => revoked.push(url),
  });
});
afterEach(async () => {
  for (const scope of scopes.splice(0)) scope.stop();
  await settle();
  for (const { target, key, descriptor } of originals) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});
async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Vue.nextTick();
}
function fixture(
  load: (artist: string) => Promise<ArrayBuffer>,
  find: (artist: string) => Promise<boolean> = async () => false,
) {
  const warnings: unknown[] = [];
  const photo = evaluateSource<typeof Photo>(transpileScript(source), {
    vue: Vue,
    "@/features/artwork/artist/api": { readArtistPhoto: load, findArtistPhoto: find },
    "@/shared/notifications/center": { notify: (value: unknown) => warnings.push(value) },
  });
  function subscribe(name: Vue.Ref<string | null>) {
    const scope = Vue.effectScope();
    scopes.push(scope);
    const result = scope.run(() => photo.usePhoto(name));
    if (!result) throw new Error("Missing photo subscription");
    return { ...result, scope };
  }
  return { ...photo, subscribe, warnings };
}

it("shares one decoded photo between sidebar and header and refreshes both after replacement", async () => {
  const names: string[] = [];
  const photo = fixture(async (name) => {
    names.push(name);
    return new Uint8Array([1]).buffer;
  });
  const row = photo.subscribe(Vue.ref("Artist"));
  const header = photo.subscribe(Vue.ref("Artist"));
  await settle();
  expect(names).toEqual(["Artist"]);
  expect(row.url.value).toBe("blob:photo-1");
  expect(header.url.value).toBe(row.url.value);
  photo.refreshArtistPhoto("Artist");
  await settle();
  expect(names).toEqual(["Artist", "Artist"]);
  expect(row.url.value).toBe("blob:photo-2");
  expect(header.url.value).toBe(row.url.value);
  row.scope.stop();
  expect(revoked).not.toContain("blob:photo-2");
  header.scope.stop();
  expect(revoked).toContain("blob:photo-2");
});

it("searches missing photos but never searches unknown artists", async () => {
  const names: string[] = [];
  const searched: string[] = [];
  const photo = fixture(
    async (name) => {
      names.push(name);
      return new ArrayBuffer(0);
    },
    async (name) => {
      searched.push(name);
      return false;
    },
  );
  const unknown = photo.subscribe(Vue.ref(null));
  const missing = photo.subscribe(Vue.ref("Missing"));
  await settle();
  expect(names).toEqual(["Missing"]);
  expect(searched).toEqual(["Missing"]);
  expect(unknown.url.value).toBeNull();
  expect(missing.url.value).toBeNull();
  expect(created).toBe(0);
  expect(photo.warnings).toEqual([]);
});

it("discards the old artist's delayed response when selection changes", async () => {
  let resolve!: (data: ArrayBuffer) => void;
  const pending = new Promise<ArrayBuffer>((done) => {
    resolve = done;
  });
  const photo = fixture(async (name) => (name === "A" ? pending : new Uint8Array([2]).buffer));
  const name = Vue.ref<string | null>("A");
  const header = photo.subscribe(name);
  name.value = "B";
  await settle();
  expect(header.url.value).toBe("blob:photo-1");
  resolve(new Uint8Array([1]).buffer);
  await settle();
  expect(header.url.value).toBe("blob:photo-1");
  expect(created).toBe(1);
});

it("reports loading failures while retaining icon fallback", async () => {
  const photo = fixture(async () => {
    throw new Error("Read failed");
  });
  const header = photo.subscribe(Vue.ref("Artist"));
  await settle();
  expect(header.url.value).toBeNull();
  expect(photo.warnings).toHaveLength(1);
});

it("loads downloaded photos once and shares the result between visible subscriptions", async () => {
  let saved = false;
  let reads = 0;
  const searched: string[] = [];
  const photo = fixture(
    async () => {
      reads++;
      return saved ? new Uint8Array([1]).buffer : new ArrayBuffer(0);
    },
    async (name) => {
      searched.push(name);
      saved = true;
      return true;
    },
  );
  const row = photo.subscribe(Vue.ref("Artist"));
  const header = photo.subscribe(Vue.ref("Artist"));
  await settle();
  expect(searched).toEqual(["Artist"]);
  expect(reads).toBe(2);
  expect(row.url.value).toBe("blob:photo-1");
  expect(header.url.value).toBe(row.url.value);
  photo.refreshArtistPhoto("Artist");
  await settle();
  expect(searched).toEqual(["Artist"]);
  expect(reads).toBe(3);
});

it("keeps manual replacements when an older automatic request finishes", async () => {
  let finish!: (found: boolean) => void;
  const pending = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  let saved = false;
  const photo = fixture(
    async () => (saved ? new Uint8Array([2]).buffer : new ArrayBuffer(0)),
    async () => pending,
  );
  const header = photo.subscribe(Vue.ref("Artist"));
  await settle();
  saved = true;
  photo.refreshArtistPhoto("Artist");
  await settle();
  expect(header.url.value).toBe("blob:photo-1");
  finish(true);
  await settle();
  expect(header.url.value).toBe("blob:photo-1");
  expect(created).toBe(1);
});

it("automatic lookup failures retain the icon without notification spam", async () => {
  const photo = fixture(
    async () => new ArrayBuffer(0),
    async () => {
      throw new Error("Offline");
    },
  );
  const header = photo.subscribe(Vue.ref("Artist"));
  await settle();
  expect(header.url.value).toBeNull();
  expect(photo.warnings).toEqual([]);
});
