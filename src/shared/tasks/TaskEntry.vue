<template>
  <div v-if="tasks.items.value.length" class="flex items-center" @mousedown.stop @click.stop>
    <button
      type="button"
      :popovertarget="panelId"
      :aria-label="t('后台任务')"
      :aria-expanded="open"
      class="focus-visible:outline-app-accent relative flex h-8 min-w-8 items-center justify-center gap-1.5 rounded px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2"
    >
      <svg
        v-if="singlePercentage !== undefined"
        viewBox="0 0 20 20"
        class="size-4 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class="opacity-20"
        />
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          pathLength="100"
          :stroke-dasharray="`${singlePercentage} 100`"
        />
      </svg>
      <LoaderCircle v-else aria-hidden="true" class="size-4 motion-safe:animate-spin" />
      <span v-if="singlePercentage !== undefined">{{ singlePercentage }}%</span>
      <span v-else-if="tasks.active.value.length > 1">{{ tasks.active.value.length }}</span>
    </button>
    <section
      :id="panelId"
      popover="auto"
      :aria-label="t('后台任务')"
      class="bg-app-interactive fixed top-14 right-3 bottom-auto left-auto m-0 max-h-[calc(100dvh-5rem)] w-96 max-w-[calc(100dvw-1.5rem)] overflow-y-auto rounded-xl border border-white/15 p-4 text-sm text-white shadow-xl"
      @toggle="onToggle"
    >
      <header class="mb-3 flex items-center gap-2 border-b border-white/10 pb-3">
        <h2 class="min-w-0 flex-1 font-medium">{{ t("后台任务") }}</h2>
        <button
          type="button"
          :popovertarget="panelId"
          popovertargetaction="hide"
          :aria-label="t('收起')"
          class="focus-visible:outline-app-accent rounded p-1 hover:bg-white/10 focus-visible:outline-2"
        >
          <X aria-hidden="true" class="size-4" />
        </button>
      </header>
      <div class="space-y-4">
        <article
          v-for="task in tasks.items.value"
          :key="task.key"
          class="min-w-0 space-y-2"
          data-background-task
          :data-task-key="task.key"
        >
          <p class="wrap-anywhere">{{ task.message }}</p>
          <progress
            :aria-label="task.message"
            :value="task.total ? task.completed : undefined"
            :max="Math.max(1, task.total ?? 1)"
            class="accent-app-accent h-1.5 w-full"
          ></progress>
          <div class="flex items-center justify-between gap-3 text-xs">
            <span class="text-app-muted">{{
              task.phase === "queued"
                ? t("排队中")
                : task.total
                  ? `${task.completed} / ${task.total} · ${taskPercentage(task)}%`
                  : t("进行中")
            }}</span>
            <button
              v-if="task.cancel"
              type="button"
              :disabled="task.cancelling"
              class="focus-visible:outline-app-accent rounded px-2 py-1 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
              @click="task.cancel()"
            >
              {{ task.cancelling ? t("正在取消…") : t("取消") }}
            </button>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, useId, watch } from "vue";
import { LoaderCircle, X } from "@lucide/vue";
import { t } from "@/shared/i18n/locale";
import { tasks, taskPercentage } from "@/shared/tasks/state";

const panelId = useId();
const open = ref(false);
const singlePercentage = computed(() => {
  const active = tasks.active.value;
  return active.length === 1 && active[0]!.phase !== "queued"
    ? taskPercentage(active[0]!)
    : undefined;
});

function focusTask(event: globalThis.Event) {
  const panel = globalThis.document?.getElementById(panelId);
  panel?.showPopover();
  const key = (event as globalThis.CustomEvent<string>).detail;
  for (const entry of panel?.querySelectorAll<globalThis.HTMLElement>("[data-task-key]") ?? []) {
    if (entry.dataset.taskKey === key) {
      entry.scrollIntoView({ block: "nearest" });
      break;
    }
  }
}
onMounted(() => globalThis.window?.addEventListener("newbee:task-focus", focusTask));
onBeforeUnmount(() => globalThis.window?.removeEventListener("newbee:task-focus", focusTask));

function onToggle(event: globalThis.Event) {
  open.value = (event as globalThis.ToggleEvent).newState === "open";
}

watch(
  () => tasks.items.value.length,
  (count) => {
    if (!count) open.value = false;
  },
);
</script>
