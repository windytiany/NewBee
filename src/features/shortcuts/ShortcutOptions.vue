<script setup lang="ts">
import { watch } from "vue";
import { t } from "@/shared/i18n/locale";
import { RotateCcw, Undo2 } from "@lucide/vue";
import { BINDING_GROUPS } from "@/features/shortcuts/groups";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  allowsGlobalShortcut,
} from "@/features/shortcuts/bindings";
import { useRecorder } from "@/features/shortcuts/useRecorder";
import type { Settings } from "@/features/settings/types";
const shortcuts = defineModel<Settings["shortcuts"]>({ required: true });
const props = defineProps<{ disabled: boolean; session: number }>();
const { selectedShortcutAction, shortcutLabels, resetShortcuts, resetShortcut, recordShortcut } =
  useRecorder(shortcuts);
watch(
  () => props.session,
  () => {
    selectedShortcutAction.value = "previous";
  },
);
</script>

<template>
  <div class="mb-3 flex shrink-0 items-center justify-between gap-2">
    <h3 class="self-start text-sm font-semibold">{{ t("快捷键") }}</h3>
    <button
      type="button"
      :aria-label="t('恢复默认')"
      :disabled="disabled"
      class="focus-visible:outline-app-accent ml-auto rounded-lg p-2 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
      @click="resetShortcuts"
    >
      <RotateCcw :size="16" aria-hidden="true" />
    </button>
  </div>
  <fieldset :disabled="disabled" class="flex min-h-0 min-w-0 flex-1 flex-col">
    <legend class="sr-only">{{ t("快捷键") }}</legend>
    <div class="min-h-0 overflow-auto rounded-lg border border-white/10">
      <table class="w-full min-w-96 table-fixed text-left text-sm">
        <thead class="text-app-muted bg-app-surface sticky top-0 z-10">
          <tr>
            <th scope="col" class="w-32 px-3 py-2 font-medium">{{ t("操作") }}</th>
            <th scope="col" class="px-3 py-2 font-medium">{{ t("快捷键") }}</th>
            <th scope="col" class="w-16 px-3 py-2 text-center font-medium">
              {{ t("全局") }}
            </th>
            <th scope="col" class="w-12 px-2 py-2">
              <span class="sr-only">{{ t("恢复默认") }}</span>
            </th>
          </tr>
        </thead>
        <tbody v-for="group in BINDING_GROUPS" :key="group.id" :data-shortcut-group="group.id">
          <tr>
            <th
              colspan="4"
              scope="rowgroup"
              class="text-app-muted bg-white/5 px-3 pt-4 pb-2 text-xs font-semibold"
            >
              {{ t(group.label) }}
            </th>
          </tr>
          <tr
            v-for="action in group.actions"
            :key="action"
            :data-shortcut-action="action"
            :class="selectedShortcutAction === action ? 'bg-app-accent/15' : 'hover:bg-white/5'"
          >
            <td class="px-3 py-2">{{ t(shortcutLabels[action]) }}</td>
            <td class="px-1 py-1">
              <input
                :aria-label="`${t(shortcutLabels[action])} ${t('快捷键')}`"
                autocomplete="off"
                :name="`shortcut-${action}`"
                :value="formatShortcut(shortcuts[action].shortcut)"
                data-shortcut-recorder
                type="text"
                readonly
                class="focus-visible:outline-app-accent w-full min-w-0 cursor-pointer rounded-lg bg-transparent px-2 py-1 text-sm text-white focus:bg-white/5 focus-visible:outline-2"
                @focus="selectedShortcutAction = action"
                @click="selectedShortcutAction = action"
                @keydown="recordShortcut($event, action)"
              />
            </td>
            <td class="px-3 py-2 text-center">
              <input
                v-if="allowsGlobalShortcut(action)"
                v-model="shortcuts[action].global"
                :aria-label="`${t(shortcutLabels[action])} ${t('全局')}`"
                :name="`shortcuts-global-${action}`"
                type="checkbox"
                class="accent-app-accent cursor-pointer"
              />
            </td>
            <td class="px-2 py-1">
              <button
                v-if="
                  shortcuts[action].shortcut !== DEFAULT_SHORTCUTS[action].shortcut ||
                  shortcuts[action].global !== DEFAULT_SHORTCUTS[action].global
                "
                type="button"
                :aria-label="`${t('恢复默认')} ${t(shortcutLabels[action])}`"
                class="text-app-muted focus-visible:outline-app-accent rounded-lg p-2 hover:bg-white/10 hover:text-white focus-visible:outline-2"
                @click="resetShortcut(action)"
              >
                <Undo2 :size="16" aria-hidden="true" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </fieldset>
</template>
