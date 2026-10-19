import { afterEach, beforeEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { loadSourceModules } from "../../../support/module/loader";
import type { TrackArtwork } from "@/features/artwork/types";

const originals = [
  [globalThis, "Image", Object.getOwnPropertyDescriptor(globalThis, "Image")],
  [globalThis, "document", Object.getOwnPropertyDescriptor(globalThis, "document")],
  [URL, "createObjectURL", Object.getOwnPropertyDescriptor(URL, "createObjectURL")],
  [URL, "revokeObjectURL", Object.getOwnPropertyDescriptor(URL, "revokeObjectURL")],
] as const;
const scopes: Vue.EffectScope[] = [];
const requests: Array<{
  trackId: number;
  size: number | null;
  resolve: (value: TrackArtwork) => void;
}> = [];
let canvasCount = 0;
let canvasAvailable = true;
let pending = false;
const warnings: unknown[] = [];
const dependencies: Record<string, unknown> = {
  vue: Vue,
  "@/shared/notifications/center": { notify: (input: unknown) => warnings.push(input) },
  "@tauri-apps/api/core": {
    invoke(command: string, args: { trackId: number; size: number | null }) {
      if (command === "is_track_metadata_pending") return Promise.resolve(pending);
      expect(command).toBe("get_track_artwork");
      return new Promise<TrackArtwork>((resolve) => requests.push({ ...args, resolve }));
    },
  },
};
await loadSourceModules(["features/artwork/useTrackArtwork.ts"], dependencies);
const { useTrackArtwork, invalidateTrackArtworkCache } = dependencies[
  "@/features/artwork/useTrackArtwork"
] as typeof import("@/features/artwork/useTrackArtwork");
async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
  await Vue.nextTick();
}
function subscribe(purpose: "cover" | "background" = "background") {
  const scope = Vue.effectScope();
  scopes.push(scope);
  const artwork = scope.run(() => useTrackArtwork(91, 32, purpose));
  if (!artwork) throw new Error("Missing artwork");
  return artwork;
}
beforeEach(() => {
  requests.length = 0;
  warnings.length = 0;
  canvasCount = 0;
  canvasAvailable = true;
  pending = false;
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: class {
      src = "";
      decode() {
        return Promise.resolve();
      }
      removeAttribute() {
        this.src = "";
      }
    },
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:track" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
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
              getImageData: () => ({ data: new Uint8ClampedArray(32 * 32 * 4).fill(255) }),
              putImageData() {},
            };
          },
          toDataURL: () => `data:image/png;base64,background-${canvasCount}`,
        };
      },
    },
  });
});
afterEach(async () => {
  for (const scope of scopes.splice(0)) scope.stop();
  await settle();
  for (const [target, key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});
it("按曲目读取封面并生成背景，更新封面后重新生成", async () => {
  const artwork = subscribe();
  await settle();
  expect(requests.map(({ trackId, size }) => ({ trackId, size }))).toEqual([
    { trackId: 91, size: 128 },
  ]);
  expect(artwork.status.value).toBe("loading");
  requests[0]!.resolve(new Uint8Array([1]).buffer);
  await settle();
  expect(artwork.background.value).toEqual({
    imageUrl: "data:image/png;base64,background-1",
    color: "rgb(255, 255, 255)",
  });
  invalidateTrackArtworkCache([91]);
  await settle();
  expect(artwork.status.value).toBe("loading");
  expect(artwork.background.value).toBeNull();
  requests[1]!.resolve(new Uint8Array([2]).buffer);
  await settle();
  expect(artwork.background.value?.imageUrl).toBe("data:image/png;base64,background-2");
});
it("普通封面订阅不生成背景", async () => {
  const artwork = subscribe("cover");
  await settle();
  requests[0]!.resolve(new Uint8Array([1]).buffer);
  await settle();
  expect(artwork.status.value).toBe("ready");
  expect(artwork.background.value).toBeNull();
  expect(canvasCount).toBe(0);
});
it("元数据未完成时保持加载，完成后生成背景", async () => {
  pending = true;
  const artwork = subscribe();
  await settle();
  expect(requests).toEqual([]);
  expect(artwork.status.value).toBe("loading");
  pending = false;
  invalidateTrackArtworkCache([91]);
  await settle();
  requests[0]!.resolve(new Uint8Array([1]).buffer);
  await settle();
  expect(artwork.background.value).not.toBeNull();
});
it("无封面或生成失败时无背景，生成失败报告错误", async () => {
  const artwork = subscribe();
  await settle();
  requests[0]!.resolve(new ArrayBuffer(0));
  await settle();
  expect(artwork.status.value).toBe("fallback");
  expect(artwork.background.value).toBeNull();
  canvasAvailable = false;
  invalidateTrackArtworkCache([91]);
  await settle();
  requests[1]!.resolve(new Uint8Array([1]).buffer);
  await settle();
  expect(artwork.status.value).toBe("ready");
  expect(artwork.background.value).toBeNull();
  expect(artwork.error.value).toContain("Canvas 2D");
  expect(warnings).toHaveLength(1);
});
