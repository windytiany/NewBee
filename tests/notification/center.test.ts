import { afterEach, describe, expect, it } from "bun:test";
import { effectScope, nextTick, ref } from "vue";
import { createNotificationCenter, notifications } from "@/notification/center";
import { useNotification } from "@/notification/useNotification";

function createClock() {
  let time = 0;
  type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
  const tasks = new Map<TimerHandle, { due: number; callback: () => void }>();
  const clock = {
    now: () => time,
    schedule(callback: () => void, delay: number) {
      // The cancelled runtime timer supplies an opaque handle; only this clock runs callbacks.
      const id = globalThis.setTimeout(() => {}, 0);
      globalThis.clearTimeout(id);
      tasks.set(id, { due: time + delay, callback });
      return id;
    },
    cancel: (id: TimerHandle) => {
      tasks.delete(id);
    },
  };
  function advance(ms: number) {
    const end = time + ms;
    while (true) {
      const next = [...tasks.entries()]
        .filter(([, task]) => task.due <= end)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (!next) break;
      time = next[1].due;
      tasks.delete(next[0]);
      next[1].callback();
    }
    time = end;
  }
  return { clock, advance, tasks };
}

afterEach(() => notifications.clear());

describe("notification center", () => {
  it("success/info expire after four seconds, warning/error remain dismissable", () => {
    const { clock, advance } = createClock();
    const center = createNotificationCenter(clock);
    center.notify({ type: "success", message: "saved" });
    center.notify({ type: "info", message: "already saved" });
    const warning = center.notify({ type: "warning", message: "partially saved" });
    const error = center.notify({ type: "error", message: "failed" });
    advance(3_999);
    expect(center.items.value).toHaveLength(4);
    advance(1);
    expect(center.visible.value.map(({ id }) => id)).toEqual([warning, error]);
    advance(60_000);
    expect(center.items.value).toHaveLength(2);
    center.dismiss(error);
    center.dismiss(warning);
    expect(center.items.value).toEqual([]);
  });

  it("queued notifications only start their lifetime when visible", () => {
    const { clock, advance } = createClock();
    const center = createNotificationCenter(clock);
    const errors = [1, 2, 3].map((id) => center.notify({ type: "error", message: String(id) }));
    const queued = center.notify({ type: "success", message: "queued" });
    expect(center.visible.value).toHaveLength(3);
    advance(60_000);
    expect(center.items.value).toHaveLength(4);
    center.dismiss(errors[0]);
    expect(center.visible.value.map(({ id }) => id)).toEqual([errors[1], errors[2], queued]);
    advance(3_999);
    expect(center.items.value).toHaveLength(3);
    advance(1);
    expect(center.items.value).toHaveLength(2);
    center.clear();
  });

  it("hover and keyboard focus independently pause the remaining lifetime", () => {
    const { clock, advance } = createClock();
    const center = createNotificationCenter(clock);
    const id = center.notify({ type: "success", message: "saved" });
    advance(2_000);
    center.pause(id, "hover", true);
    center.pause(id, "focus", true);
    advance(10_000);
    center.pause(id, "hover", false);
    advance(10_000);
    expect(center.items.value).toHaveLength(1);
    center.pause(id, "focus", false);
    advance(1_999);
    expect(center.items.value).toHaveLength(1);
    advance(1);
    expect(center.items.value).toEqual([]);
  });

  it("deduplicates by source key without merging unrelated notifications", () => {
    const center = createNotificationCenter(createClock().clock);
    const id = center.notify({ type: "error", message: "failed", key: "volume" });
    expect(center.notify({ type: "error", message: "failed", key: "volume" })).toBe(id);
    center.notify({ type: "error", message: "failed", key: "queue" });
    expect(center.items.value.map(({ count }) => count)).toEqual([2, 1]);
    center.notify({ type: "warning", message: "new outcome", key: "volume" });
    expect(center.items.value[0]).toMatchObject({ id, type: "warning", count: 1 });
    center.dismiss(id);
    expect(center.notify({ type: "error", message: "failed", key: "volume" })).not.toBe(id);
    center.clear();
  });

  it("resets a deduplicated timed message and cancels timers on close/clear", () => {
    const { clock, advance, tasks } = createClock();
    const center = createNotificationCenter(clock);
    const id = center.notify({ type: "info", message: "saved", key: "directory" });
    advance(3_000);
    center.notify({ type: "info", message: "saved", key: "directory" });
    advance(3_999);
    expect(center.items.value).toHaveLength(1);
    center.dismiss(id);
    expect(tasks.size).toBe(0);
    center.notify({ type: "success", message: "saved" });
    center.clear();
    expect(tasks.size).toBe(0);
    advance(60_000);
    expect(center.items.value).toEqual([]);
  });

  it("retains hover/focus pauses when a persistent message becomes timed", () => {
    const { clock, advance, tasks } = createClock();
    const center = createNotificationCenter(clock);
    const id = center.notify({ type: "error", message: "failed", key: "operation" });
    center.pause(id, "focus", true);
    center.notify({ type: "success", message: "saved", key: "operation" });
    expect(tasks.size).toBe(0);
    advance(60_000);
    expect(center.items.value).toHaveLength(1);
    center.pause(id, "focus", false);
    advance(4_000);
    expect(center.items.value).toEqual([]);
  });

  it("a timed message changed to an error does not silently expire", () => {
    const { clock, advance, tasks } = createClock();
    const center = createNotificationCenter(clock);
    center.notify({ type: "success", message: "saved", key: "operation" });
    center.notify({ type: "error", message: "failed", key: "operation" });
    expect(tasks.size).toBe(0);
    advance(60_000);
    expect(center.items.value[0].message).toBe("failed");
    center.clear();
  });
});

describe("notification outcome observation", () => {
  it("dismissal does not clear business state or reshow on unrelated updates", async () => {
    notifications.clear();
    const error = ref("failed");
    const scope = effectScope();
    scope.run(() =>
      useNotification(() =>
        error.value
          ? {
              type: "error",
              message: error.value,
              key: "test-outcome",
            }
          : null,
      ),
    );
    expect(notifications.items.value).toHaveLength(1);
    notifications.dismiss(notifications.items.value[0].id);
    await nextTick();
    expect(error.value).toBe("failed");
    expect(notifications.items.value).toEqual([]);
    error.value = "";
    await nextTick();
    error.value = "failed";
    await nextTick();
    expect(notifications.items.value).toHaveLength(1);
    scope.stop();
    notifications.clear();
    error.value = "another failure";
    await nextTick();
    expect(notifications.items.value).toEqual([]);
  });
});
