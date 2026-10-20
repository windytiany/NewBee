import { computed, readonly, shallowRef } from "vue";

export type TaskProgress = {
  key: string;
  message: string;
  completed: number;
  total?: number;
  cancelling?: boolean;
  cancel?: () => void;
};
export type TaskResult = { type: "warning" | "error"; message: string };
export type Task = TaskProgress & { result?: TaskResult; unread?: boolean };

export function createTaskCenter() {
  const items = shallowRef<Task[]>([]);
  const active = computed(() => items.value.filter((task) => !task.result));
  const unread = computed(() => items.value.some((task) => task.unread));

  function update(task: TaskProgress) {
    const index = items.value.findIndex((item) => item.key === task.key);
    const next = { ...task };
    if (index < 0) items.value = [...items.value, next];
    else items.value = items.value.map((item, position) => (position === index ? next : item));
  }

  function finish(key: string, result?: TaskResult) {
    items.value = items.value.flatMap((task) => {
      if (task.key !== key || task.result) return [task];
      return result
        ? [{ ...task, cancel: undefined, cancelling: false, result, unread: true }]
        : [];
    });
  }

  function acknowledge() {
    items.value = items.value.map((task) => (task.unread ? { ...task, unread: false } : task));
  }

  function clearFinished() {
    items.value = items.value.filter((task) => !task.result || task.unread);
  }

  return {
    items: readonly(items),
    active: readonly(active),
    unread: readonly(unread),
    update,
    finish,
    acknowledge,
    clearFinished,
  };
}

export const tasks = createTaskCenter();

export function taskPercentage(task: Pick<TaskProgress, "completed" | "total">) {
  if (!task.total || task.total <= 0) return undefined;
  return Math.min(100, Math.max(0, Math.floor((task.completed / task.total) * 100)));
}
