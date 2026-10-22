import { readonly, shallowRef } from "vue";
import { notify } from "@/shared/notifications/center";

export type TaskProgress = {
  key: string;
  message: string;
  completed: number;
  total?: number;
  phase?: "queued" | "running" | "cancelling";
  cancelling?: boolean;
  cancel?: () => void;
};
export type TaskResult = {
  type: "warning" | "error";
  message: string;
  details?: readonly string[];
};
export type Task = TaskProgress;

export function createTaskCenter(report: typeof notify = notify) {
  const items = shallowRef<Task[]>([]);

  function update(task: TaskProgress) {
    const index = items.value.findIndex((item) => item.key === task.key);
    const previous = items.value[index];
    const next = { ...previous, ...task };
    if (previous?.cancelling) next.cancelling = true;
    if (index < 0) items.value = [...items.value, next];
    else items.value = items.value.map((item, position) => (position === index ? next : item));
  }

  function finish(key: string, result?: TaskResult) {
    if (!items.value.some((task) => task.key === key)) return;
    items.value = items.value.filter((task) => task.key !== key);
    if (result) report({ type: result.type, message: result.message, key });
  }

  return {
    items: readonly(items),
    active: readonly(items),
    update,
    finish,
  };
}

export const tasks = createTaskCenter();

export function taskPercentage(task: Pick<TaskProgress, "completed" | "total">) {
  if (!task.total || task.total <= 0) return undefined;
  return Math.min(100, Math.max(0, Math.floor((task.completed / task.total) * 100)));
}
