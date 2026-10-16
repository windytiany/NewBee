<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { X } from "@lucide/vue";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_DEFINITIONS,
  formatShortcut,
} from "@/features/shortcuts/bindings";
import type { ShortcutAction } from "@/features/shortcuts/bindings";
import { SHORTCUT_GROUPS } from "@/features/shortcuts/groups";
import type { ShortcutSettings } from "@/features/settings/types";
import { getContextCommands } from "@/features/shortcuts/context";
import type { ContextCommands } from "@/features/shortcuts/context";
import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";

const props = defineProps<{
  bindings: ShortcutSettings;
  run: (action: ShortcutAction, context?: ContextCommands) => Promise<void>;
}>();
const dialog = ref<globalThis.HTMLDialogElement | null>(null);
const input = ref<globalThis.HTMLInputElement | null>(null);
const mode = ref<"commands" | "shortcuts">("commands");
const query = ref("");
const selected = ref(0);
let trigger: globalThis.HTMLElement | null = null;
let context: ContextCommands = {};
const actions = computed(() =>
  SHORTCUT_ACTIONS.filter((action) =>
    t(SHORTCUT_DEFINITIONS[action].label)
      .toLocaleLowerCase()
      .includes(query.value.trim().toLocaleLowerCase()),
  ),
);
function available(action: ShortcutAction) {
  return action !== "addToQueue" || Boolean(context.addToQueue);
}
async function show(nextMode: typeof mode.value = "commands") {
  if (dialog.value?.open) return;
  trigger =
    globalThis.document.activeElement instanceof globalThis.HTMLElement
      ? globalThis.document.activeElement
      : null;
  context = getContextCommands(trigger);
  mode.value = nextMode;
  query.value = "";
  selected.value = 0;
  dialog.value?.showModal();
  await nextTick();
  input.value?.focus();
}
function close() {
  dialog.value?.close();
}
function restoreFocus() {
  if (!globalThis.document.querySelector("dialog[open]") && trigger?.isConnected) trigger.focus();
}
async function execute(action: ShortcutAction) {
  if (!available(action)) return;
  close();
  await nextTick();
  restoreFocus();
  try {
    await props.run(action, context);
  } catch (reason) {
    logger.error("shortcuts", "command_failed", reason);
    notify({ type: "error", message: t("快捷键操作失败，请查看日志"), key: "shortcut-error" });
  }
}
function onKeydown(event: globalThis.KeyboardEvent) {
  if (event.isComposing || mode.value !== "commands") return;
  if (
    ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) &&
    (event.key.startsWith("Arrow") || event.ctrlKey || event.target !== input.value)
  ) {
    event.preventDefault();
    const length = actions.value.length;
    if (!length) return;
    selected.value =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? length - 1
          : (selected.value + (event.key === "ArrowDown" ? 1 : -1) + length) % length;
    const option = dialog.value?.querySelector<globalThis.HTMLElement>(
      `[data-command-index="${selected.value}"]`,
    );
    option?.scrollIntoView({ block: "nearest" });
    if (event.target !== input.value) option?.focus({ preventScroll: true });
  } else if (event.key === "Enter" && event.target === input.value) {
    event.preventDefault();
    const action = actions.value[selected.value];
    if (action) void execute(action);
  }
}
defineExpose({ show });
</script>

<template>
  <dialog
    ref="dialog"
    data-item-interaction
    :aria-label="t(mode === 'commands' ? '命令面板' : '快捷键总览')"
    class="sidebar-scrollbars bg-app-surface m-auto max-h-[80vh] w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/50"
    @cancel.prevent="close"
    @close="restoreFocus"
    @click.self="close"
    @keydown="onKeydown"
    @mousedown.stop
  >
    <header class="flex items-center justify-between border-b border-white/10 px-5 py-3">
      <h2 class="font-semibold">{{ t(mode === "commands" ? "命令面板" : "快捷键总览") }}</h2>
      <button
        type="button"
        :aria-label="t('关闭')"
        class="focus-visible:outline-app-accent text-app-muted inline-flex size-7 items-center justify-center rounded-full hover:bg-white/10 hover:text-white focus-visible:outline-2"
        @click="close"
      >
        <X aria-hidden="true" class="size-4" />
      </button>
    </header>
    <div v-if="mode === 'commands'" class="px-5 py-3">
      <label for="command-query" class="sr-only">{{ t("命令") }}</label>
      <input
        id="command-query"
        ref="input"
        v-model="query"
        type="text"
        autocomplete="off"
        role="combobox"
        aria-expanded="true"
        aria-controls="command-results"
        aria-autocomplete="list"
        :aria-activedescendant="actions[selected] ? `command-${actions[selected]}` : undefined"
        class="focus-visible:outline-app-accent w-full rounded border border-white/10 bg-white/5 px-3 py-2 focus-visible:outline-2"
        @input="selected = 0"
      />
    </div>
    <ul
      v-if="mode === 'commands'"
      id="command-results"
      role="listbox"
      class="max-h-[50vh] overflow-y-auto p-2"
      :aria-label="t('操作')"
    >
      <li v-for="(action, index) in actions" :key="action" role="none">
        <button
          :id="`command-${action}`"
          role="option"
          tabindex="-1"
          :aria-selected="selected === index"
          type="button"
          :data-command-index="index"
          :disabled="!available(action)"
          class="focus-visible:outline-app-accent flex w-full items-center justify-between gap-4 rounded px-3 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-40"
          :class="{ 'bg-white/10': selected === index }"
          @click="execute(action)"
        >
          <span>{{ t(SHORTCUT_DEFINITIONS[action].label) }}</span>
          <kbd class="text-app-muted whitespace-nowrap">{{
            formatShortcut(bindings[action].shortcut)
          }}</kbd>
        </button>
      </li>
      <li v-if="!actions.length" role="status" class="text-app-muted px-3 py-2 text-sm">
        {{ t("无匹配操作") }}
      </li>
    </ul>
    <div v-else class="max-h-[50vh] overflow-y-auto p-2">
      <section
        v-for="group in SHORTCUT_GROUPS"
        :key="group.id"
        :data-shortcut-group="group.id"
        :aria-labelledby="`shortcut-group-${group.id}`"
        class="mb-3 last:mb-0"
      >
        <h3
          :id="`shortcut-group-${group.id}`"
          class="text-app-muted px-3 pt-3 pb-1 text-xs font-semibold"
        >
          {{ t(group.label) }}
        </h3>
        <ul>
          <li
            v-for="action in group.actions"
            :key="action"
            :data-shortcut-action="action"
            class="flex items-center justify-between gap-4 px-3 py-2 text-sm"
          >
            <span>{{ t(SHORTCUT_DEFINITIONS[action].label) }}</span>
            <span class="text-app-muted"
              ><kbd>{{ formatShortcut(bindings[action].shortcut) || t("未绑定") }}</kbd
              >{{ bindings[action].global ? ` · ${t("全局")}` : "" }}</span
            >
          </li>
          <li
            v-for="[key, label] in group.keys"
            :key="key"
            class="flex justify-between gap-4 px-3 py-2 text-sm"
          >
            <span>{{ t(label) }}</span
            ><kbd class="text-app-muted">{{ key }}</kbd>
          </li>
        </ul>
      </section>
    </div>
  </dialog>
</template>
