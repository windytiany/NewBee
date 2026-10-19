import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { createUpdater } from "@/shared/update/controller";
import type { NotificationInput } from "@/shared/notifications/center";
import { evaluateSource, transpileScript } from "../support/module/loader";

const output = transpileScript(await Bun.file("src/app/update.ts").text());

function fixture(result: "available" | "latest" | "failed", supported = true) {
  let checks = 0;
  let opened = 0;
  const feedback: NotificationInput[] = [];
  const updater = createUpdater({
    supported,
    check: async () => {
      checks++;
      if (result === "failed") throw new Error("HTTP 404");
      if (result === "latest") return null;
      return {
        version: "0.2.0",
        download: async () => {},
        install: async () => {},
        close: async () => {},
      };
    },
    failed: () => {},
  });
  let mounted!: () => Promise<void>;
  let unmounted!: () => void;
  let stopped = false;
  const { useStartupUpdates, waitForUpdates } = evaluateSource<{
    useStartupUpdates: (open: () => void) => void;
    waitForUpdates: (signal: AbortSignal) => Promise<void>;
  }>(output, {
    vue: {
      ...Vue,
      onMounted: (callback: () => Promise<void>) => {
        mounted = callback;
      },
      onUnmounted: (callback: () => void) => {
        unmounted = callback;
      },
    },
    "@/shared/update/runtime": { getUpdater: () => updater },
    "@/shared/notifications/center": { notify: (input: NotificationInput) => feedback.push(input) },
    "@/shared/lifecycle/activity": {
      watchActivity: (source: unknown) => {
        expect(source).toBe(updater.busy);
        return () => {
          stopped = true;
        };
      },
    },
  });
  return {
    updater,
    waitForUpdates,
    start: () => {
      useStartupUpdates(() => {
        opened++;
      });
      return mounted();
    },
    unmount: () => unmounted(),
    feedback,
    get checks() {
      return checks;
    },
    get opened() {
      return opened;
    },
    get stopped() {
      return stopped;
    },
  };
}

describe("startup updates", () => {
  it("keeps downloaded bytes alive while hidden and cancels the release wait on reopen", async () => {
    const run = fixture("available");
    await run.start();
    await run.updater.download();
    expect(run.updater.busy.value).toBe(false);
    expect(run.updater.holdsWindow.value).toBe(true);
    const request = new AbortController();
    let finished = false;
    const waiting = run.waitForUpdates(request.signal).then(
      () => {
        finished = true;
        return undefined;
      },
      (reason: unknown) => reason,
    );
    await Vue.nextTick();
    expect(finished).toBe(false);
    request.abort(new Error("reopened"));
    expect(await waiting).toEqual(new Error("reopened"));
    expect(run.updater.phase.value).toBe("ready");
  });

  it("does not wait when no update data is held or after cancellation", async () => {
    const run = fixture("latest");
    const request = new AbortController();
    await run.waitForUpdates(request.signal);
    request.abort(new Error("cancelled"));
    await expect(run.waitForUpdates(request.signal)).rejects.toThrow("cancelled");
  });

  it("checks once and offers a direct settings action without downloading", async () => {
    const run = fixture("available");
    await run.start();
    await run.start();
    expect(run.checks).toBe(1);
    expect(run.feedback).toHaveLength(1);
    expect(run.feedback[0]?.message).toBe("发现新版本 0.2.0");
    run.feedback[0]?.action?.run();
    expect(run.opened).toBe(1);
    run.unmount();
    expect(run.stopped).toBe(true);
  });

  it.each(["latest", "failed"] as const)("keeps %s startup checks silent", async (result) => {
    const run = fixture(result);
    await run.start();
    expect(run.checks).toBe(1);
    expect(run.feedback).toEqual([]);
  });

  it("does not check outside the supported desktop", async () => {
    const run = fixture("available", false);
    await run.start();
    expect(run.checks).toBe(0);
    expect(run.feedback).toEqual([]);
  });
});
