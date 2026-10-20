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
      <LoaderCircle
        v-else-if="tasks.active.value.length"
        aria-hidden="true"
        class="size-4 motion-safe:animate-spin"
      />
      <TriangleAlert v-else aria-hidden="true" class="size-4 text-amber-200" />
      <span v-if="singlePercentage !== undefined">{{ singlePercentage }}%</span>
      <span v-else-if="tasks.active.value.length > 1">{{ tasks.active.value.length }}</span>
      <span
        v-if="tasks.unread.value"
        class="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-amber-300"
        :aria-label="t('任务异常')"
      ></span>
    </button>
    <section
      :id="panelId"
      popover="auto"
      :aria-label="t('后台任务')"
      class="bg-app-interactive fixed top-14 right-3 bottom-auto left-auto m-0 max-h-[calc(100dvh-5rem)] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-white/15 p-4 text-sm text-white shadow-xl"
      @toggle="onToggle"
    >
      <header class="mb-3 flex items-center justify-between gap-3">
        <h2 class="font-medium">{{ t("后台任务") }}</h2>
        <button
          v-if="hasFinished"
          type="button"
          class="focus-visible:outline-app-accent rounded px-2 py-1 text-xs text-white/60 hover:bg-white/10 focus-visible:outline-2"
          @click="tasks.clearFinished()"
        >
          {{ t("清除") }}
        </button>
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
          class="space-y-2"
          data-background-task
        >
          <p class="wrap-anywhere">{{ task.message }}</p>
          <p v-if="task.result" role="status" class="wrap-anywhere text-amber-200">
            {{ task.result.message }}
          </p>
          <template v-else>
            <progress
              :aria-label="task.message"
              :value="task.total ? task.completed : undefined"
              :max="Math.max(1, task.total ?? 1)"
              class="accent-app-accent h-1.5 w-full"
            ></progress>
            <div class="flex items-center justify-between gap-3 text-xs">
              <span class="text-app-muted">{{
                task.total
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
          </template>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { LoaderCircle, TriangleAlert, X } from "@lucide/vue";
import { t } from "@/shared/i18n/locale";
import { tasks, taskPercentage } from "@/shared/tasks/state";

const panelId = useId();
const open = ref(false);
const singlePercentage = computed(() => {
  const active = tasks.active.value;
  return active.length === 1 ? taskPercentage(active[0]!) : undefined;
});
const hasFinished = computed(() => tasks.items.value.some((task) => task.result));

function onToggle(event: globalThis.Event) {
  open.value = (event as globalThis.ToggleEvent).newState === "open";
  if (open.value) tasks.acknowledge();
  else tasks.clearFinished();
}

watch(
  () => tasks.unread.value,
  (unread) => {
    if (open.value && unread) tasks.acknowledge();
  },
);
watch(
  () => tasks.items.value.length,
  (count) => {
    if (!count) open.value = false;
  },
);
</script>
