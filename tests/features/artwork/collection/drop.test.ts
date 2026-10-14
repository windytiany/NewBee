import { expect, it } from "bun:test";
import * as Vue from "vue";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { evaluateSource, transpileScript } from "../../../support/module/loader";

const output = transpileScript(await Bun.file("src/features/artwork/collection/useDrop.ts").text());
function fixture(subscription?: Promise<() => void>) {
  let mounted: () => Promise<void> = async () => {};
  let dispose: () => void = () => {};
  let listener: (event: { payload: DragDropEvent }) => void = () => {};
  let enabled = true;
  let dropped = 0;
  let stops = 0;
  const failures: unknown[] = [];
  const { usePictureDrop } = evaluateSource<typeof import("@/features/artwork/collection/useDrop")>(
    output,
    {
      vue: {
        ...Vue,
        onMounted: (hook: () => Promise<void>) => {
          mounted = hook;
        },
        onScopeDispose: (hook: () => void) => {
          dispose = hook;
        },
      },
      "@tauri-apps/api/core": { isTauri: () => true },
      "@tauri-apps/api/webview": {
        getCurrentWebview: () => ({
          onDragDropEvent: async (callback: typeof listener) => {
            listener = callback;
            return subscription
              ? await subscription
              : () => {
                  stops++;
                };
          },
        }),
      },
    },
  );
  const path = usePictureDrop(
    () => enabled,
    () => {
      dropped++;
    },
    (error) => failures.push(error),
  );
  return {
    path,
    failures,
    mount: () => mounted(),
    dispose: () => dispose(),
    enable: (value: boolean) => {
      enabled = value;
    },
    emit: (paths: string[]) =>
      listener({ payload: { type: "drop", paths, position: new PhysicalPosition(0, 0) } }),
    counts: () => ({ dropped, stops }),
  };
}

it("captures real native drop paths only while the collection is editable", async () => {
  const drop = fixture();
  await drop.mount();
  drop.emit(["D:/cover.png"]);
  expect(drop.path.value).toBe("D:/cover.png");
  expect(drop.counts().dropped).toBe(1);
  drop.enable(false);
  drop.emit(["D:/other.png"]);
  expect(drop.path.value).toBe("D:/cover.png");
  drop.enable(true);
  drop.emit(["D:/one.png", "D:/two.png"]);
  expect(String(drop.failures[0])).toContain("请选择一张图片");
  expect(drop.path.value).toBe("D:/cover.png");
  drop.dispose();
  drop.emit(["D:/late.png"]);
  expect(drop.path.value).toBe("D:/cover.png");
  expect(drop.counts().stops).toBe(1);
});

it("unsubscribes a native listener whose registration completes after disposal", async () => {
  let finish: (stop: () => void) => void = () => {};
  let stops = 0;
  const registration = new Promise<() => void>((resolve) => {
    finish = resolve;
  });
  const drop = fixture(registration);
  const mounted = drop.mount();
  drop.dispose();
  finish(() => {
    stops++;
  });
  await mounted;
  expect(stops).toBe(1);
  drop.emit(["D:/late.png"]);
  expect(drop.path.value).toBeNull();
});
