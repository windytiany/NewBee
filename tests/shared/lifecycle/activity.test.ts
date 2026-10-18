import { describe, expect, it } from "bun:test";
import { nextTick, ref } from "vue";
import {
  beforeRelease,
  prepareRelease,
  waitForIdle,
  watchActivity,
} from "@/shared/lifecycle/activity";

describe("WebView-dependent activity", () => {
  it("waits for all operations, including work started while waiting", async () => {
    const first = ref(true);
    const second = ref(false);
    const stopFirst = watchActivity(first);
    const stopSecond = watchActivity(second);
    try {
      let idle = false;
      const waiting = waitForIdle(new AbortController().signal).then(() => {
        idle = true;
      });
      second.value = true;
      first.value = false;
      await nextTick();
      expect(idle).toBe(false);
      second.value = false;
      await waiting;
      expect(idle).toBe(true);
    } finally {
      stopFirst();
      stopSecond();
    }
  });

  it("does not treat a transition between consecutive tasks as idle", async () => {
    const busy = ref(true);
    const stop = watchActivity(busy);
    try {
      let idle = false;
      const waiting = waitForIdle(new AbortController().signal).then(() => {
        idle = true;
      });
      busy.value = false;
      busy.value = true;
      await nextTick();
      expect(idle).toBe(false);
      busy.value = false;
      await waiting;
      expect(idle).toBe(true);
    } finally {
      stop();
    }
  });

  it("aborts waiting without cancelling the underlying operation", async () => {
    const busy = ref(true);
    const stop = watchActivity(busy);
    try {
      const controller = new AbortController();
      const waiting = waitForIdle(controller.signal);
      controller.abort(new Error("reopened"));
      await expect(waiting).rejects.toThrow("reopened");
      expect(busy.value).toBe(true);
      busy.value = false;
      await waitForIdle(new AbortController().signal);
    } finally {
      stop();
    }
  });

  it("checks discard guards and removes them on disposal", async () => {
    let calls = 0;
    const remove = beforeRelease(async () => {
      calls++;
      return false;
    });
    expect(await prepareRelease(new AbortController().signal)).toBe(false);
    expect(calls).toBe(1);
    remove();
    expect(await prepareRelease(new AbortController().signal)).toBe(true);
    const controller = new AbortController();
    controller.abort();
    expect(await prepareRelease(controller.signal)).toBe(false);
  });
});
