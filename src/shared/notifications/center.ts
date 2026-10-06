import { computed, readonly, shallowRef } from "vue";

export type NotificationType = "success" | "info" | "warning" | "error";
export type NotificationInput = {
  type: NotificationType;
  message: string;
  key?: string;
  persistent?: boolean;
};
export type Notification = NotificationInput & { id: number; count: number };
export type TaskNotification = {
  key: string;
  message: string;
  completed: number;
  total: number;
  cancelling: boolean;
  cancel: () => void;
};
type PauseReason = "hover" | "focus";
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
type Clock = {
  now: () => number;
  schedule: (callback: () => void, delay: number) => TimerHandle;
  cancel: (handle: TimerHandle) => void;
};
type Lifetime = {
  remaining: number;
  startedAt: number;
  handle: TimerHandle | undefined;
  reasons: Set<PauseReason>;
};

const AUTO_DISMISS_MS = 4_000;
const MAX_VISIBLE = 3;
const systemClock: Clock = {
  now: () => performance.now(),
  schedule: (callback, delay) => globalThis.setTimeout(callback, delay),
  cancel: (handle) => globalThis.clearTimeout(handle),
};

export function createNotificationCenter(clock: Clock = systemClock) {
  const items = shallowRef<Notification[]>([]);
  const tasks = shallowRef<TaskNotification[]>([]);

  function updateTask(task: TaskNotification) {
    tasks.value = [...tasks.value.filter((item) => item.key !== task.key), task];
  }

  function removeTask(key: string) {
    tasks.value = tasks.value.filter((item) => item.key !== key);
  }
  const visible = computed(() => items.value.slice(0, MAX_VISIBLE));
  const lifetimes = new Map<number, Lifetime>();
  let nextId = 0;

  function stop(lifetime: Lifetime) {
    if (lifetime.handle === undefined) return;
    clock.cancel(lifetime.handle);
    lifetime.handle = undefined;
    lifetime.remaining = Math.max(0, lifetime.remaining - (clock.now() - lifetime.startedAt));
  }

  function syncTimers() {
    const visibleIds = new Set(
      visible.value.flatMap(({ id, persistent }) => (persistent ? [] : [id])),
    );
    for (const [id, lifetime] of lifetimes) {
      if (!visibleIds.has(id) || lifetime.reasons.size > 0) {
        stop(lifetime);
      } else if (lifetime.handle === undefined) {
        lifetime.startedAt = clock.now();
        lifetime.handle = clock.schedule(() => dismiss(id), lifetime.remaining);
      }
    }
  }

  function dismiss(id: number) {
    const lifetime = lifetimes.get(id);
    if (lifetime) stop(lifetime);
    lifetimes.delete(id);
    items.value = items.value.filter((item) => item.id !== id);
    syncTimers();
  }

  function notify(input: NotificationInput) {
    const existing = input.key ? items.value.find((item) => item.key === input.key) : undefined;
    const id = existing?.id ?? ++nextId;
    let count = 1;
    if (existing) {
      if (existing.type === input.type && existing.message === input.message)
        count = existing.count + 1;
      items.value = items.value.map((item) => (item.id === id ? { ...input, id, count } : item));
    } else {
      items.value = [...items.value, { ...input, id, count }];
    }
    const lifetime = lifetimes.get(id);
    if (lifetime) stop(lifetime);
    lifetimes.set(id, {
      remaining: AUTO_DISMISS_MS,
      startedAt: 0,
      handle: undefined,
      reasons: lifetime?.reasons ?? new Set(),
    });
    syncTimers();
    return id;
  }

  function pause(id: number, reason: PauseReason, paused: boolean) {
    const lifetime = lifetimes.get(id);
    if (!lifetime) return;
    if (paused) lifetime.reasons.add(reason);
    else lifetime.reasons.delete(reason);
    syncTimers();
  }

  function clear() {
    for (const lifetime of lifetimes.values()) stop(lifetime);
    lifetimes.clear();
    items.value = [];
  }

  return {
    items: readonly(items),
    visible: readonly(visible),
    tasks: readonly(tasks),
    updateTask,
    removeTask,
    notify,
    dismiss,
    pause,
    clear,
  };
}

export const notifications = createNotificationCenter();
export const notify = notifications.notify;
