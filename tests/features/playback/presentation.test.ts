import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { effectScope } from "vue";
import type { EffectScope } from "vue";
import { useDisplayMode } from "@/features/playback/composables/useDisplayMode";

const STORAGE_KEY = "newbee.playing-presentation";
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalConsoleError = globalThis.console.error;
const scopes: EffectScope[] = [];
let storedValues: Map<string, string>;
let loggedErrors: unknown[][];
let storage: Pick<typeof globalThis.localStorage, "getItem" | "setItem">;

function mountPresentation() {
  const scope = effectScope();
  let state!: ReturnType<typeof useDisplayMode>;
  scope.run(() => {
    state = useDisplayMode();
  });
  scopes.push(scope);
  return { ...state, scope };
}

beforeEach(() => {
  storedValues = new Map();
  loggedErrors = [];
  storage = {
    getItem: (key) => storedValues.get(key) ?? null,
    setItem: (key, value) => {
      storedValues.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  globalThis.console.error = (...args: unknown[]) => {
    loggedErrors.push(args);
  };
});

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
  globalThis.console.error = originalConsoleError;
});

describe("NowPlayingPage 布局持久化", () => {
  it("首次使用默认 track 布局", () => {
    const { presentation } = mountPresentation();
    expect(presentation.value).toBe("track");
    expect(storedValues.get(STORAGE_KEY)).toBe("track");
  });

  for (const mode of ["track", "lyrics", "both"] as const) {
    it(`读取并恢复 ${mode} 布局`, () => {
      storedValues.set(STORAGE_KEY, mode);
      expect(mountPresentation().presentation.value).toBe(mode);
      expect(loggedErrors).toEqual([]);
    });
  }

  it("切换后立即保存，重建页面状态时恢复最后的选择", () => {
    const first = mountPresentation();
    first.presentation.value = "lyrics";
    expect(storedValues.get(STORAGE_KEY)).toBe("lyrics");
    first.presentation.value = "both";
    expect(storedValues.get(STORAGE_KEY)).toBe("both");
    first.scope.stop();

    const restarted = mountPresentation();
    expect(restarted.presentation.value).toBe("both");
    restarted.presentation.value = "track";
    expect(storedValues.get(STORAGE_KEY)).toBe("track");
  });

  for (const invalidMode of ["", "unknown", '"lyrics"', "null"]) {
    it(`无效值 ${JSON.stringify(invalidMode)} 回退并修正为 track`, () => {
      storedValues.set(STORAGE_KEY, invalidMode);
      expect(mountPresentation().presentation.value).toBe("track");
      expect(storedValues.get(STORAGE_KEY)).toBe("track");
    });
  }

  it("存储读取失败时使用默认布局，不阻止后续切换", () => {
    storage.getItem = () => {
      throw new Error("storage unavailable");
    };
    const { presentation } = mountPresentation();
    expect(presentation.value).toBe("track");
    expect(loggedErrors).toHaveLength(1);
    presentation.value = "both";
    expect(storedValues.get(STORAGE_KEY)).toBe("both");
  });

  it("存储写入失败时保留内存中的选择并报告错误", () => {
    storage.setItem = () => {
      throw new Error("storage full");
    };
    const { presentation } = mountPresentation();
    presentation.value = "lyrics";
    expect(presentation.value).toBe("lyrics");
    expect(loggedErrors).toHaveLength(2);
    expect(loggedErrors[1]?.[0]).toBe("Could not save the playing presentation.");
  });

  it("页面卸载后不再写入存储", () => {
    const { presentation, scope } = mountPresentation();
    scope.stop();
    presentation.value = "both";
    expect(storedValues.get(STORAGE_KEY)).toBe("track");
  });
});
