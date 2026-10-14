import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import * as Vue from "vue";
import type { useAddition as AdditionFactory } from "@/features/artwork/collection/useAddition";
import { evaluateSource, transpileScript } from "../../../support/module/loader";

const source = await Bun.file("src/features/artwork/collection/useAddition.ts").text();
const scopes: Vue.EffectScope[] = [];
const createUrl = spyOn(globalThis.URL, "createObjectURL").mockImplementation(
  () => "blob:addition",
);
const revokeUrl = spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
afterAll(() => {
  createUrl.mockRestore();
  revokeUrl.mockRestore();
});
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  createUrl.mockClear();
  revokeUrl.mockClear();
});
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture(
  overrides: {
    select?: () => Promise<{ data: Uint8Array; path: string } | null>;
    mime?: () => Promise<string>;
    save?: (data: number[], current: () => boolean) => Promise<string | undefined>;
    add?: () => Promise<string | undefined>;
  } = {},
) {
  const enabled = Vue.ref(true);
  const context = Vue.shallowRef<object>({});
  const calls: Array<{ data: number[]; mime: string; type: number; path?: string }> = [];
  const failures: unknown[] = [];
  const busy: boolean[] = [];
  const saves: number[][] = [];
  const reads: string[] = [];
  const { useAddition } = evaluateSource<{ useAddition: typeof AdditionFactory }>(
    transpileScript(source),
    {
      vue: Vue,
      "@/features/artwork/transfer": {
        selectCover:
          overrides.select ??
          (async () => ({ data: Uint8Array.from([1, 2]), path: "D:/cover.png" })),
        pictureMimeType: overrides.mime ?? (async () => "image/png"),
        readClipboardCover: async () => [3, 4],
        readCover: async (path: string) => {
          reads.push(path);
          return Uint8Array.from([5, 6]);
        },
        saveCover: async (data: number[], current: () => boolean) => {
          saves.push(data);
          return overrides.save ? overrides.save(data, current) : "D:/clipboard.png";
        },
      },
    },
  );
  const scope = Vue.effectScope();
  scopes.push(scope);
  const addition = scope.run(() =>
    useAddition({
      enabled: () => enabled.value,
      context: () => context.value,
      pictureType: () => 4,
      add: async (data, mime, type, path) => {
        calls.push({ data: Array.from(data), mime, type, path });
        return overrides.add ? overrides.add() : "new";
      },
      failed: (error) => failures.push(error),
      busy: (value) => busy.push(value),
    }),
  );
  if (!addition) throw new Error("Missing addition scope");
  return { addition, scope, enabled, context, calls, failures, busy, saves, reads };
}

describe("picture addition staging", () => {
  for (const storage of ["embedded", "linked"] as const) {
    it(`stages a validated file then confirms ${storage} with the selected purpose`, async () => {
      const { addition, calls, busy } = fixture();
      await addition.select();
      expect(calls).toEqual([]);
      expect(addition.pending.value?.path).toBe("D:/cover.png");
      expect(addition.pending.value?.mimeType).toBe("image/png");
      expect(addition.working.value).toBe(false);
      expect(addition.active.value).toBe(true);
      expect(busy).toEqual([true]);
      await addition.confirm(storage);
      expect(calls).toEqual([
        {
          data: [1, 2],
          mime: "image/png",
          type: 4,
          path: storage === "linked" ? "D:/cover.png" : undefined,
        },
      ]);
      expect(addition.pending.value).toBeNull();
      expect(busy).toEqual([true, false]);
      expect(revokeUrl).toHaveBeenCalledWith("blob:addition");
    });
  }
  it("cancel releases the preview and leaves the draft untouched", async () => {
    const { addition, calls, busy } = fixture();
    await addition.select();
    addition.cancel();
    expect(calls).toEqual([]);
    expect(addition.pending.value).toBeNull();
    expect(busy).toEqual([true, false]);
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });
  it("native picker cancellation restores idle without creating a preview", async () => {
    const { addition, calls, busy } = fixture({ select: async () => null });
    await addition.select();
    expect(calls).toEqual([]);
    expect(busy).toEqual([true, false]);
    expect(createUrl).not.toHaveBeenCalled();
  });
  it("clipboard remains staged when external save is cancelled and can then embed", async () => {
    const { addition, calls, saves, busy } = fixture({ save: async () => undefined });
    await addition.paste();
    expect(saves).toEqual([]);
    expect(calls).toEqual([]);
    await addition.confirm("linked");
    expect(saves).toEqual([[3, 4]]);
    expect(calls).toEqual([]);
    expect(addition.active.value).toBe(true);
    expect(addition.working.value).toBe(false);
    expect(busy).toEqual([true]);
    expect(revokeUrl).not.toHaveBeenCalled();
    await addition.confirm("embedded");
    expect(calls).toEqual([{ data: [3, 4], mime: "image/png", type: 4, path: undefined }]);
  });
  it("clipboard links only after external save returns a real path", async () => {
    const save = deferred<string | undefined>();
    const { addition, calls, saves } = fixture({ save: () => save.promise });
    await addition.paste();
    const confirm = addition.confirm("linked");
    expect(saves).toEqual([[3, 4]]);
    expect(calls).toEqual([]);
    expect(addition.working.value).toBe(true);
    save.resolve("D:/saved.png");
    await confirm;
    expect(calls[0]?.path).toBe("D:/saved.png");
  });
  it("native drop reads the actual path and awaits confirmation", async () => {
    const { addition, calls, reads } = fixture();
    await addition.dropPath("D:/dropped.jpg");
    expect(reads).toEqual(["D:/dropped.jpg"]);
    expect(calls).toEqual([]);
    await addition.confirm("linked");
    expect(calls[0]).toEqual({ data: [5, 6], mime: "image/png", type: 4, path: "D:/dropped.jpg" });
  });
  for (const change of ["disabled", "context", "unmount"] as const) {
    it(`releases staged preview on ${change}`, async () => {
      const { addition, enabled, context, scope, calls, busy } = fixture();
      await addition.select();
      if (change === "disabled") enabled.value = false;
      if (change === "context") context.value = {};
      if (change === "unmount") scope.stop();
      expect(addition.pending.value).toBeNull();
      expect(calls).toEqual([]);
      expect(revokeUrl).toHaveBeenCalledTimes(1);
      expect(busy[busy.length - 1]).toBe(false);
    });
    it(`ignores MIME validation that resolves after ${change}`, async () => {
      const mime = deferred<string>();
      const { addition, enabled, context, scope, calls, busy } = fixture({
        mime: () => mime.promise,
      });
      const read = addition.select();
      await Promise.resolve();
      if (change === "disabled") enabled.value = false;
      if (change === "context") context.value = {};
      if (change === "unmount") scope.stop();
      mime.resolve("image/png");
      await read;
      expect(addition.pending.value).toBeNull();
      expect(createUrl).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
      expect(busy[busy.length - 1]).toBe(false);
    });
  }
  it("does not submit a clipboard save which resolves after disabled", async () => {
    const save = deferred<string | undefined>();
    let current = () => true;
    const { addition, enabled, calls } = fixture({
      save: (_data, isCurrent) => {
        current = isCurrent;
        return save.promise;
      },
    });
    await addition.paste();
    const confirm = addition.confirm("linked");
    enabled.value = false;
    expect(current()).toBe(false);
    save.resolve("D:/late.png");
    await confirm;
    expect(calls).toEqual([]);
    expect(addition.pending.value).toBeNull();
  });
  it("blocks duplicate reads and confirmations during submission", async () => {
    const add = deferred<string | undefined>();
    const { addition, calls, busy } = fixture({ add: () => add.promise });
    await addition.select();
    await addition.paste();
    expect(addition.pending.value?.path).toBe("D:/cover.png");
    const confirm = addition.confirm("embedded");
    await addition.confirm("linked");
    addition.cancel();
    expect(calls).toHaveLength(1);
    expect(addition.pending.value).not.toBeNull();
    expect(busy).toEqual([true]);
    add.resolve("new");
    await confirm;
    expect(busy).toEqual([true, false]);
  });
  it("keeps an editor-reported failure staged without notifying twice", async () => {
    let succeed = false;
    const { addition, calls, failures, busy } = fixture({
      add: async () => (succeed ? "new" : undefined),
    });
    await addition.select();
    await addition.confirm("embedded");
    expect(calls).toHaveLength(1);
    expect(failures).toEqual([]);
    expect(addition.pending.value).not.toBeNull();
    expect(addition.working.value).toBe(false);
    expect(busy).toEqual([true]);
    expect(revokeUrl).not.toHaveBeenCalled();
    succeed = true;
    await addition.confirm("embedded");
    expect(calls).toHaveLength(2);
    expect(addition.pending.value).toBeNull();
    expect(busy).toEqual([true, false]);
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });
  it("keeps a failed submission available for retry without leaking its preview", async () => {
    const { addition, failures } = fixture({
      add: async () => {
        throw new Error("add failed");
      },
    });
    await addition.select();
    await addition.confirm("embedded");
    expect(String(failures[0])).toContain("add failed");
    expect(addition.working.value).toBe(false);
    expect(addition.pending.value).not.toBeNull();
    expect(revokeUrl).not.toHaveBeenCalled();
    addition.cancel();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });
});
